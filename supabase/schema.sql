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
-- הרשאות מפורשות ל-service_role (צד השרת של Netlify בלבד).
-- בפרויקטי ענן ותיקים service_role קיבל הכל דרך default privileges; בהתקנות
-- חדשות — וגם בסטאק המקומי של supabase start — אובייקטים אינם נחשפים
-- אוטומטית, ולכן ההענקה כאן מפורשת. anon/authenticated נשארים חסומים לגמרי.
-- survey_configs בכוונה בלי update/delete — ה-trigger למעלה אוכף append-only.
-- ============================================================
grant usage on schema public to service_role;
grant select, insert                 on public.survey_events  to service_role;
grant select, insert, update, delete on public.surveys        to service_role;
grant select, insert, update, delete on public.survey_drafts  to service_role;
grant select, insert                 on public.survey_configs to service_role;
grant usage, select on all sequences in schema public to service_role;

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
grant select on public.completed_responses to service_role;

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
grant select on public.screen_funnel to service_role;

-- ============================================================
-- סטטיסטיקות למסך ה-stats בקונסולה (ENG-12..ENG-18)
-- שכבה 1: session_stats — שורת סיכום אחת לכל סשן.
--
-- "סשן בדיקה" = vars של session_start מכילים url_test (קישור שנפתח עם ?test=1).
-- זו נקודת ההגדרה היחידה של הכלל — כל פונקציות הסטטיסטיקה מסננות דרכה,
-- וקונסולת הניהול יכולה לבקש include_test כדי לראות גם אותם.
--
-- vars אפקטיביים = מהאירוע האחרון שנושא vars: אירוע סיום עדיף על answer
-- מועשר, שעדיף על session_start. סשן שנטש עם לקוח ישן (בלי vars ב-answer)
-- נשאר עם ה-vars ההתחלתיים — משתנה מחושב כמו segment יופיע בו כ"לא ידוע".
-- ⚠ הכלל url_test והשמות כאן מסונכרנים עם tests/sync/stats-sql.test.ts.
-- ============================================================

create or replace view public.session_stats
  with (security_invoker = true) as
select
  session_id,
  max(survey_version)                                                        as survey_version,
  (select c.survey_id from public.survey_configs c
    where c.version = max(e.survey_version))                                 as survey_id,
  min(created_at) filter (where event_type = 'session_start')                as started_at,
  max(created_at)                                                            as last_event_at,
  max(event_type) filter (where event_type in
    ('complete','screenout','quotafull'))                                    as outcome,
  bool_or(event_type = 'answer')                                             as answered_any,
  coalesce(bool_or(event_type = 'session_start'
                   and payload -> 'vars' ? 'url_test'), false)               as is_test,
  (array_agg(payload -> 'vars' order by created_at desc)
     filter (where payload ? 'vars'))[1]                                     as vars
from public.survey_events e
group by session_id;

revoke all on public.session_stats from anon, authenticated;
grant select on public.session_stats to service_role;

-- שכבה 2: פונקציות אגרגציה שה-endpoint המאומת (admin-stats) קורא דרך rpc.
-- drop לפני create — שינוי חתימה או עמודות החזרה ב-create or replace נכשל,
-- וה-drop המפורש משאיר את הקובץ ניתן להרצה חוזרת.

-- אריחי הסקירה: סה"כ, הושלמו, סוננו, מכסה מלאה, ונטישה מפוצלת לשניים —
-- "נטשו באמצע" (ענו לפחות פעם אחת) מול "נכנסו ולא ענו כלל" (בוטים/הצצה).
drop function if exists public.stats_overview(text, text, boolean);
create function public.stats_overview(p_survey text, p_version text, p_include_test boolean)
returns table (
  total_sessions   int,
  completed        int,
  screened_out     int,
  quota_full       int,
  abandoned_mid    int,
  abandoned_bounce int
)
language sql stable
set search_path = public
as $$
  select
    count(*)::int,
    (count(*) filter (where outcome = 'complete'))::int,
    (count(*) filter (where outcome = 'screenout'))::int,
    (count(*) filter (where outcome = 'quotafull'))::int,
    (count(*) filter (where outcome is null and answered_any))::int,
    (count(*) filter (where outcome is null and not answered_any))::int
  from session_stats
  where survey_id = p_survey
    and started_at is not null
    and (p_version is null or survey_version = p_version)
    and (p_include_test or not is_test)
$$;

revoke execute on function public.stats_overview(text, text, boolean) from public, anon, authenticated;
grant execute on function public.stats_overview(text, text, boolean) to service_role;

-- משפך פר-מסך: צפו, ענו, נטשו-כאן (הצפייה האחרונה של סשן בלי אירוע סיום),
-- וחציון זמן ניסיון-ראשון בלבד — מענה חוזר אחרי חזרה אחורה מהיר בסדר גודל
-- והיה מטה את החציון כלפי מטה. מסכי end לא מופיעים: אין להם screen_view.
drop function if exists public.stats_funnel(text, text, boolean);
create function public.stats_funnel(p_survey text, p_version text, p_include_test boolean)
returns table (
  screen_id    text,
  viewed       int,
  answered     int,
  dropped_here int,
  median_ms    int
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id, outcome from session_stats
    where survey_id = p_survey
      and started_at is not null
      and (p_version is null or survey_version = p_version)
      and (p_include_test or not is_test)
  ),
  ev as (
    select e.session_id, e.event_type, e.screen_id, e.created_at, e.payload
    from survey_events e
    join s using (session_id)
    where e.screen_id is not null and e.event_type in ('screen_view', 'answer')
  ),
  drops as (
    -- הצפייה האחרונה של כל סשן שלא הגיע לאירוע סיום = המסך שבו נעלם
    select distinct on (ev.session_id) ev.session_id, ev.screen_id
    from ev
    join s using (session_id)
    where ev.event_type = 'screen_view' and s.outcome is null
    order by ev.session_id, ev.created_at desc
  )
  select
    ev.screen_id,
    (count(distinct ev.session_id) filter (where ev.event_type = 'screen_view'))::int,
    (count(distinct ev.session_id) filter (where ev.event_type = 'answer'))::int,
    coalesce(d.dropped, 0),
    (percentile_cont(0.5) within group (order by (ev.payload ->> 'ms')::numeric)
       filter (where ev.event_type = 'answer'
               and coalesce((ev.payload ->> 'attempt')::int, 1) = 1))::int
  from ev
  left join (
    select drops.screen_id, count(*)::int as dropped from drops group by drops.screen_id
  ) d using (screen_id)
  group by ev.screen_id, d.dropped
$$;

revoke execute on function public.stats_funnel(text, text, boolean) from public, anon, authenticated;
grant execute on function public.stats_funnel(text, text, boolean) to service_role;

-- התשובה הסופית: שורה אחת לכל סשן×מסך — האירוע עם ה-attempt הגבוה ביותר
-- (שוויון נשבר לפי זמן). מי שחזר אחורה ושינה תשובה נספר פעם אחת, עם מה שבחר
-- בסוף. value נשאר jsonb גולמי — הפירוש (אטומים, תוויות) נעשה בשכבות שמעל.
create or replace view public.final_answers
  with (security_invoker = true) as
select distinct on (e.session_id, e.screen_id)
  e.session_id,
  e.survey_version,
  e.screen_id,
  e.payload -> 'value'                          as value,
  coalesce((e.payload ->> 'attempt')::int, 1)   as attempt,
  e.created_at
from public.survey_events e
where e.event_type = 'answer' and e.screen_id is not null
order by e.session_id, e.screen_id,
         coalesce((e.payload ->> 'attempt')::int, 1) desc, e.created_at desc;

revoke all on public.final_answers from anon, authenticated;
grant select on public.final_answers to service_role;

-- התפלגויות: כלל פריסת-אטומים אחד לכל סוגי השאלות הסגורות —
--   מחרוזת/מספר/בוליאני → אטום אחד (הערך עצמו כטקסט)
--   מערך (רב-ברירה)     → אטום לכל אפשרות שנבחרה
--   אובייקט (מטריצה)    → אטום לכל פריט, item_id = הפריט, המפתח = הציון/na
--   null (דילוג מכוון)   → לא אטום; נספר בסטטיסטיקות התשובות הפתוחות בלבד
-- פילוח (p_by): שם משתנה סשן אפקטיבי, או ‎_outcome‎ לתוצאת הסשן. סשן בלי
-- ערך למימד מקבל dim_value=null — "לא ידוע" בתצוגה, לעולם לא נזרק.
-- התוצאה: ספירות גולמיות לפי (מסך, פריט, מפתח, מימד) — תוויות ואחוזים בדפדפן.
drop function if exists public.stats_distributions(text, text, boolean);
drop function if exists public.stats_distributions(text, text, boolean, text);
create function public.stats_distributions(
  p_survey text, p_version text, p_include_test boolean, p_by text default null
)
returns table (
  screen_id  text,
  item_id    text,
  answer_key text,
  dim_value  text,
  n          int
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id,
           case
             when p_by is null then null
             when p_by = '_outcome' then coalesce(outcome,
               case when answered_any then 'abandoned_mid' else 'abandoned_bounce' end)
             else vars ->> p_by
           end as dim_value
    from session_stats
    where survey_id = p_survey
      and started_at is not null
      and (p_version is null or survey_version = p_version)
      and (p_include_test or not is_test)
  ),
  fa as (
    select f.screen_id, f.value, s.dim_value
    from final_answers f
    join s using (session_id)
    where (p_version is null or f.survey_version = p_version)
      and f.value is not null
      and jsonb_typeof(f.value) <> 'null'
  ),
  atoms as (
    select fa.screen_id, null::text as item_id, fa.value #>> '{}' as answer_key, fa.dim_value
    from fa where jsonb_typeof(fa.value) in ('string', 'number', 'boolean')
    union all
    select fa.screen_id, null, elem.val, fa.dim_value
    from fa, lateral jsonb_array_elements_text(fa.value) elem(val)
    where jsonb_typeof(fa.value) = 'array'
    union all
    select fa.screen_id, kv.key, kv.value #>> '{}', fa.dim_value
    from fa, lateral jsonb_each(fa.value) kv
    where jsonb_typeof(fa.value) = 'object'
  )
  select atoms.screen_id, atoms.item_id, atoms.answer_key, atoms.dim_value, count(*)::int
  from atoms
  group by atoms.screen_id, atoms.item_id, atoms.answer_key, atoms.dim_value
$$;

revoke execute on function public.stats_distributions(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.stats_distributions(text, text, boolean, text) to service_role;

-- בסיסי אחוזים לפילוח: כמה סשנים ענו (תשובה סופית שאינה null) על כל מסך,
-- בכל ערך מימד — המכנה של אחוזי-מהעונים בקבוצה. אותם פילטרים כמו למעלה.
drop function if exists public.stats_bases(text, text, boolean, text);
create function public.stats_bases(
  p_survey text, p_version text, p_include_test boolean, p_by text default null
)
returns table (
  screen_id text,
  dim_value text,
  answered  int
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id,
           case
             when p_by is null then null
             when p_by = '_outcome' then coalesce(outcome,
               case when answered_any then 'abandoned_mid' else 'abandoned_bounce' end)
             else vars ->> p_by
           end as dim_value
    from session_stats
    where survey_id = p_survey
      and started_at is not null
      and (p_version is null or survey_version = p_version)
      and (p_include_test or not is_test)
  )
  select f.screen_id, s.dim_value, count(distinct f.session_id)::int
  from final_answers f
  join s using (session_id)
  where (p_version is null or f.survey_version = p_version)
    and f.value is not null
    and jsonb_typeof(f.value) <> 'null'
  group by f.screen_id, s.dim_value
$$;

revoke execute on function public.stats_bases(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.stats_bases(text, text, boolean, text) to service_role;

-- תשובות פתוחות, מטא-דאטה שלא דורש קריאה: שלושת המצבים — ענו (תשובה סופית
-- שאינה null), דילגו במכוון (תשובה סופית null), נטשו (צפו במסך ולא ענו כלל) —
-- ואחוזוני אורך התשובה. שום ניתוח תוכן: אורכים וספירות בלבד.
drop function if exists public.open_answer_stats(text, text, boolean, text);
create function public.open_answer_stats(
  p_survey text, p_version text, p_include_test boolean, p_screen text
)
returns table (
  screen_id  text,
  answered   int,
  skipped    int,
  abandoned  int,
  len_min    int,
  len_median int,
  len_p90    int,
  len_max    int
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id from session_stats
    where survey_id = p_survey
      and started_at is not null
      and (p_version is null or survey_version = p_version)
      and (p_include_test or not is_test)
  ),
  ev as (
    select e.screen_id, e.session_id, e.event_type
    from survey_events e
    join s using (session_id)
    where e.screen_id is not null
      and e.event_type in ('screen_view', 'answer')
      and (p_screen is null or e.screen_id = p_screen)
  ),
  fa as (
    select f.screen_id, f.value
    from final_answers f
    join s using (session_id)
    where (p_version is null or f.survey_version = p_version)
      and (p_screen is null or f.screen_id = p_screen)
  ),
  lens as (
    select fa.screen_id, char_length(fa.value #>> '{}') as len
    from fa where jsonb_typeof(fa.value) = 'string'
  )
  select
    v.screen_id,
    coalesce(a.answered, 0),
    coalesce(a.skipped, 0),
    v.viewed - coalesce(any_ans.n, 0) as abandoned,
    l.len_min, l.len_median, l.len_p90, l.len_max
  from (
    select ev.screen_id, count(distinct ev.session_id)::int as viewed
    from ev where ev.event_type = 'screen_view' group by ev.screen_id
  ) v
  left join (
    select ev.screen_id, count(distinct ev.session_id)::int as n
    from ev where ev.event_type = 'answer' group by ev.screen_id
  ) any_ans using (screen_id)
  left join (
    select fa.screen_id,
      (count(*) filter (where fa.value is not null and jsonb_typeof(fa.value) <> 'null'))::int as answered,
      (count(*) filter (where jsonb_typeof(fa.value) = 'null'))::int as skipped
    from fa group by fa.screen_id
  ) a using (screen_id)
  left join (
    select lens.screen_id,
      min(lens.len)::int                                            as len_min,
      (percentile_cont(0.5) within group (order by lens.len))::int  as len_median,
      (percentile_cont(0.9) within group (order by lens.len))::int  as len_p90,
      max(lens.len)::int                                            as len_max
    from lens group by lens.screen_id
  ) l using (screen_id)
$$;

revoke execute on function public.open_answer_stats(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.open_answer_stats(text, text, boolean, text) to service_role;

-- הרשימה עצמה: תשובות טקסט גולמיות, חדש-ראשון, מדופדף. הדפדפן מוסר אילו
-- מסכים הם שאלות טקסט (ל-SQL אין מושג סוגי מסכים — הקונפיג חי בדפדפן).
-- p_segment: ערך של משתנה segment; ‎__unknown__‎ = סשנים בלי ערך; null = הכל.
drop function if exists public.open_answers(text, text, boolean, text[], text, int, int);
create function public.open_answers(
  p_survey text, p_version text, p_include_test boolean,
  p_screens text[], p_segment text, p_limit int, p_offset int
)
returns table (
  total          bigint,
  screen_id      text,
  value          text,
  created_at     timestamptz,
  survey_version text,
  segment        text,
  outcome        text
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id, outcome, vars ->> 'segment' as segment
    from session_stats
    where survey_id = p_survey
      and started_at is not null
      and (p_version is null or survey_version = p_version)
      and (p_include_test or not is_test)
  )
  select
    count(*) over () as total,
    f.screen_id,
    f.value #>> '{}' as value,
    f.created_at,
    f.survey_version,
    s.segment,
    coalesce(s.outcome, 'abandoned') as outcome
  from final_answers f
  join s using (session_id)
  where (p_version is null or f.survey_version = p_version)
    and f.screen_id = any (p_screens)
    and jsonb_typeof(f.value) = 'string'
    and (p_segment is null
         or (p_segment = '__unknown__' and s.segment is null)
         or s.segment = p_segment)
  order by f.created_at desc
  limit p_limit offset p_offset
$$;

revoke execute on function public.open_answers(text, text, boolean, text[], text, int, int) from public, anon, authenticated;
grant execute on function public.open_answers(text, text, boolean, text[], text, int, int) to service_role;

-- מכסות: כמה משיבים *סיימו* עם כל ערך של סימון. זו הפונקציה היחידה כאן שקצה
-- ציבורי קורא לה (quota-get, בלי אימות) — ולכן היא מקבלת רשימת סימונים מפורשת
-- ומחזירה אך ורק ספירות עבורם, ולא חלון פתוח אל vars של המשיבים.
--
-- 'complete' בלבד: סינון אינו פרסונה שנאספה, ומי שכבר נשלח למסך מכסה-מלאה לא
-- נספר פעמיים. סשני בדיקה מוחרגים דרך session_stats — בלי זה הקליקים שלנו
-- ב-‎?test=1‎ היו סוגרים את המכסות של המחקר האמיתי.
drop function if exists public.quota_counts(text, text[]);
create function public.quota_counts(p_survey text, p_marks text[])
returns table (
  mark  text,
  value text,
  n     int
)
language sql stable
set search_path = public
as $$
  select m.mark, s.vars ->> m.mark, count(*)::int
  from session_stats s
  cross join unnest(p_marks) as m(mark)
  where s.survey_id = p_survey
    and s.outcome = 'complete'
    and not s.is_test
    and s.vars ? m.mark
  group by m.mark, s.vars ->> m.mark
$$;

revoke execute on function public.quota_counts(text, text[]) from public, anon, authenticated;
grant execute on function public.quota_counts(text, text[]) to service_role;

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
