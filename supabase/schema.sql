-- ============================================================
-- סכמת הדאטהבייס לשאלון — להדביק ולהריץ ב-Supabase SQL Editor
-- מודל: append-only. לדפדפן (anon) אין שום הרשאה — גם לא INSERT.
-- הכתיבה היחידה היא דרך Netlify Function עם service_role key.
-- קריאה נעשית רק מהדשבורד.
-- שינוי הרשאות? להריץ את הקובץ מחדש ב-SQL Editor — הקובץ בריפו
-- לא משנה כלום בעצמו.
-- ============================================================

create table if not exists public.survey_events (
  id             bigint generated always as identity primary key,
  event_uid      uuid not null unique,          -- מזהה מהלקוח: retry לא יוצר כפילות
  session_id     uuid not null,
  survey_version text not null,
  event_type     text not null check (event_type in
                   ('session_start','screen_view','answer','complete','screenout','quotafull')),
  screen_id      text,
  payload        jsonb not null default '{}'::jsonb,
  client_ts      timestamptz,                   -- שעת הלקוח (לא אמינה, לניתוח בלבד)
  created_at     timestamptz not null default now()
);

-- create table if not exists לא נוגע בטבלה קיימת, ולכן הרחבת רשימת הסוגים
-- מחייבת החלפה מפורשת של האילוץ. Postgres נותן ל-check אנונימי בדיוק את השם
-- הזה, כך שגם התקנה ותיקה מתעדכנת בהרצה חוזרת של הקובץ.
-- ⚠ מסונכרן עם EventType ב-src/data/events.ts ועם EVENT_TYPES ב-events.mts.
alter table public.survey_events drop constraint if exists survey_events_event_type_check;
alter table public.survey_events add constraint survey_events_event_type_check
  check (event_type in ('session_start','screen_view','answer','complete','screenout','quotafull'));

create index if not exists survey_events_session_idx on public.survey_events (session_id, created_at);
create index if not exists survey_events_type_idx    on public.survey_events (event_type);
create index if not exists survey_events_screen_idx  on public.survey_events (survey_version, screen_id);

-- RLS פעיל ובלי שום policy: anon ו-authenticated חסומים לחלוטין.
-- ה-Netlify Function כותב עם service_role, שעוקף RLS בכוונה —
-- ולכן הוולידציה נאכפת בפונקציה עצמה (netlify/functions/events.mts).
alter table public.survey_events enable row level security;

drop policy if exists survey_events_insert_anon on public.survey_events;
revoke all on public.survey_events from anon, authenticated;

-- ============================================================
-- שאלונים דינמיים: רשימת שאלונים, טיוטה לכל שאלון, וגרסאות שפורסמו
-- הדפדפן לעולם לא ניגש לטבלאות האלה ישירות — הכל דרך Netlify Functions:
--   config-get (קריאה ציבורית), admin-surveys / admin-draft / admin-publish
--   (עורכי first-edea בלבד).
-- ============================================================

-- שאלון = slug (מזהה בקישור הציבורי /s/<slug>) + שם לתצוגה.
-- מחיקה אמיתית מותרת רק לשאלון שלא פורסם מעולם — ה-FK מ-survey_configs
-- (בלי cascade) חוסם מחיקה של שאלון שיש לו גרסאות, כי אירועים מפנים אליהן.
-- שאלון שכבר פורסם "נמחק" ע"י ארכוב: archived_at מפסיק להגיש סשנים חדשים,
-- אבל קישור לגרסה מוצמדת ממשיך לעבוד עד שהמשיבים שבאמצע יסיימו.
-- ⚠ תבנית ה-slug משוכפלת ב-src/data/surveys.ts (SURVEY_SLUG_RE).
create table if not exists public.surveys (
  slug        text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  archived_at timestamptz
);

-- טיוטה אחת לכל שאלון (עורך יחיד לשאלון)
create table if not exists public.survey_drafts (
  survey_id  text primary key references public.surveys(slug) on delete cascade,
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

-- מיגרציה מהמודל של שאלון יחיד (survey_drafts.id = 1): הטיוטה הקיימת עוברת
-- לשאלון ברירת המחדל 'main', שהוא גם מה ש-‎/‎ ממשיך להגיש לקישורים ותיקים.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'survey_drafts'
               and column_name = 'id') then
    alter table public.survey_drafts add column if not exists survey_id text;
    insert into public.surveys (slug, name, created_by)
      select 'main', 'שאלון ראשי', 'migration'
      where exists (select 1 from public.survey_drafts)
      on conflict (slug) do nothing;
    update public.survey_drafts set survey_id = 'main' where survey_id is null;
    alter table public.survey_drafts drop constraint if exists survey_drafts_pkey;
    alter table public.survey_drafts drop column id;
    alter table public.survey_drafts alter column survey_id set not null;
    alter table public.survey_drafts add primary key (survey_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'survey_drafts_survey_id_fkey') then
    alter table public.survey_drafts add constraint survey_drafts_survey_id_fkey
      foreign key (survey_id) references public.surveys(slug) on delete cascade;
  end if;
end $$;

-- גרסאות שפורסמו — immutable append-only. סשן של משיב מוצמד לגרסה שבה התחיל,
-- ולכן אסור שגרסה שפורסמה תשתנה אי-פעם.
-- version נשאר מפתח יחיד וגלובלי (survey_events מפנה אליו בעמודה אחת),
-- ולכן הוא נושא את ה-slug בתוכו: 2026-08-08.1-<slug>.
create table if not exists public.survey_configs (
  version      text primary key,
  survey_id    text not null references public.surveys(slug),
  config       jsonb not null,
  published_at timestamptz not null default now(),
  published_by text not null
);

-- ה-backfill למטה הוא UPDATE — ה-trigger שחוסם שינוי חייב לרדת לפניו
-- (ולחזור מיד אחריו).
drop trigger if exists survey_configs_immutable on public.survey_configs;

alter table public.survey_configs add column if not exists survey_id text;

insert into public.surveys (slug, name, created_by)
  select 'main', 'שאלון ראשי', 'migration'
  where exists (select 1 from public.survey_configs where survey_id is null)
  on conflict (slug) do nothing;

update public.survey_configs set survey_id = 'main' where survey_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'survey_configs_survey_id_fkey') then
    alter table public.survey_configs add constraint survey_configs_survey_id_fkey
      foreign key (survey_id) references public.surveys(slug);
  end if;
end $$;

alter table public.survey_configs alter column survey_id set not null;

create index if not exists survey_configs_published_idx
  on public.survey_configs (published_at desc);
create index if not exists survey_configs_survey_idx
  on public.survey_configs (survey_id, published_at desc);

-- אכיפת אי-שינוי ברמת ה-DB (הגנה לעומק — גם service_role ייחסם)
create or replace function public.reject_config_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'survey_configs is append-only';
end;
$$;

create trigger survey_configs_immutable
  before update or delete on public.survey_configs
  for each row execute function public.reject_config_mutation();

-- אותה עמדת הרשאות כמו survey_events: RLS פעיל, אפס policies
alter table public.surveys        enable row level security;
alter table public.survey_drafts  enable row level security;
alter table public.survey_configs enable row level security;
revoke all on public.surveys        from anon, authenticated;
revoke all on public.survey_drafts  from anon, authenticated;
revoke all on public.survey_configs from anon, authenticated;

-- ============================================================
-- Views לניתוח (נגישות רק מהדשבורד / service key)
-- מוגדרים אחרי survey_configs כי הם נשענים עליו כדי לתרגם survey_version
-- (המזהה היחיד שיש בשורת האירוע) לשאלון שאליו היא שייכת.
-- ============================================================

-- תשובה מלאה אחת לשורה — לייצוא CSV.
-- אירועי הסיום הם complete / screenout / quotafull; outcome שומר על ההבחנה
-- ביניהם, כך שסינון אמיתי לא מתערבב עם מכסה מלאה.
create or replace view public.completed_responses
  with (security_invoker = true) as
select
  session_id,
  max(survey_version)                                                        as survey_version,
  min(created_at)  filter (where event_type = 'session_start')               as started_at,
  max(created_at)  filter (where event_type in
                     ('complete','screenout','quotafull'))                   as finished_at,
  max(event_type)  filter (where event_type in
                     ('complete','screenout','quotafull'))                   as outcome,
  (array_agg(payload order by created_at desc)
     filter (where event_type in ('complete','screenout','quotafull')))[1]   as final_payload,
  (select c.survey_id from public.survey_configs c
    where c.version = max(e.survey_version))                                 as survey_id
from public.survey_events e
group by session_id;

revoke all on public.completed_responses from anon, authenticated;

-- משפך פר-מסך: צפיות, תשובות, זמן ממוצע — לבקרת איכות ונשירה
create or replace view public.screen_funnel
  with (security_invoker = true) as
select
  survey_version,
  screen_id,
  count(distinct session_id) filter (where event_type = 'screen_view')          as sessions_viewed,
  count(distinct session_id) filter (where event_type = 'answer')               as sessions_answered,
  round(avg((payload->>'ms')::numeric) filter (where event_type = 'answer'))    as avg_ms_on_screen,
  round(percentile_cont(0.5) within group
    (order by (payload->>'ms')::numeric)
    filter (where event_type = 'answer'))                                       as median_ms_on_screen,
  (select c.survey_id from public.survey_configs c
    where c.version = survey_version)                                           as survey_id
from public.survey_events
where screen_id is not null
group by survey_version, screen_id;

revoke all on public.screen_funnel from anon, authenticated;

-- ============================================================
-- הגנה לעומק: חסימת יצירת חשבונות שאינם first-edea.com
-- ה-hook הזה רץ לפני יצירת משתמש ב-Supabase Auth, ולכן חשבון גוגל
-- שאינו מהדומיין לא נוצר בכלל (במקום להיווצר ואז לקבל 403).
--
-- שכבה נוספת בלבד — האכיפה האמיתית היא בדיקת הדומיין ב-requireAdmin
-- (netlify/functions/lib/session.ts), שרצה בכל בקשה.
--
-- ⚠️ ה-SQL לבד לא מפעיל כלום: יש לרשום את הפונקציה בדשבורד תחת
--    Authentication → Hooks → Before User Created → Postgres function.
-- ============================================================

create or replace function public.restrict_signup_to_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_email text := lower(event -> 'user' ->> 'email');
begin
  if user_email like '%@first-edea.com' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'Only first-edea.com accounts may sign in.',
      'http_code', 403
    )
  );
end;
$$;

-- רק מנגנון ה-Auth יכול להריץ את ה-hook
grant execute on function public.restrict_signup_to_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.restrict_signup_to_domain(jsonb) from anon, authenticated, public;
