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
                   ('session_start','screen_view','answer','complete','screenout')),
  screen_id      text,
  payload        jsonb not null default '{}'::jsonb,
  client_ts      timestamptz,                   -- שעת הלקוח (לא אמינה, לניתוח בלבד)
  created_at     timestamptz not null default now()
);

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
-- Views לניתוח (נגישות רק מהדשבורד / service key)
-- ============================================================

-- תשובה מלאה אחת לשורה — לייצוא CSV
create or replace view public.completed_responses
  with (security_invoker = true) as
select
  session_id,
  max(survey_version)                                                        as survey_version,
  min(created_at)  filter (where event_type = 'session_start')               as started_at,
  max(created_at)  filter (where event_type in ('complete','screenout'))     as finished_at,
  max(event_type)  filter (where event_type in ('complete','screenout'))     as outcome,
  (array_agg(payload order by created_at desc)
     filter (where event_type in ('complete','screenout')))[1]               as final_payload
from public.survey_events
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
    filter (where event_type = 'answer'))                                       as median_ms_on_screen
from public.survey_events
where screen_id is not null
group by survey_version, screen_id;

revoke all on public.screen_funnel from anon, authenticated;

-- ============================================================
-- שאלון דינמי: טיוטה + גרסאות שפורסמו
-- הדפדפן לעולם לא ניגש לטבלאות האלה ישירות — הכל דרך Netlify Functions:
--   config-get (קריאה ציבורית), admin-draft / admin-publish (עורכי first-edea בלבד).
-- ============================================================

-- טיוטה יחידה (עורך יחיד): שורה אחת בלבד, נאכף ע"י check (id = 1)
create table if not exists public.survey_drafts (
  id         int primary key default 1 check (id = 1),
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

-- גרסאות שפורסמו — immutable append-only. סשן של משיב מוצמד לגרסה שבה התחיל,
-- ולכן אסור שגרסה שפורסמה תשתנה אי-פעם.
create table if not exists public.survey_configs (
  version      text primary key,
  config       jsonb not null,
  published_at timestamptz not null default now(),
  published_by text not null
);

create index if not exists survey_configs_published_idx
  on public.survey_configs (published_at desc);

-- אכיפת אי-שינוי ברמת ה-DB (הגנה לעומק — גם service_role ייחסם)
create or replace function public.reject_config_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'survey_configs is append-only';
end;
$$;

drop trigger if exists survey_configs_immutable on public.survey_configs;
create trigger survey_configs_immutable
  before update or delete on public.survey_configs
  for each row execute function public.reject_config_mutation();

-- אותה עמדת הרשאות כמו survey_events: RLS פעיל, אפס policies
alter table public.survey_drafts  enable row level security;
alter table public.survey_configs enable row level security;
revoke all on public.survey_drafts  from anon, authenticated;
revoke all on public.survey_configs from anon, authenticated;
