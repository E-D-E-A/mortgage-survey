-- ============================================================
-- סכמת הדאטהבייס לשאלון — להדביק ולהריץ ב-Supabase SQL Editor
-- מודל: append-only. הדפדפן (anon) יכול רק להכניס אירועים —
-- לא לקרוא, לא לעדכן ולא למחוק. קריאה נעשית רק מהדשבורד.
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

-- RLS: anon מקבל אך ורק INSERT
alter table public.survey_events enable row level security;

revoke all on public.survey_events from anon, authenticated;
grant insert on public.survey_events to anon;

drop policy if exists survey_events_insert_anon on public.survey_events;
create policy survey_events_insert_anon
  on public.survey_events
  for insert
  to anon
  with check (true);

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
