-- ============================================================
-- The survey's database schema — paste it into the Supabase SQL Editor and run.
-- The model: append-only. The browser (anon) has no privilege at all — not even
-- INSERT. The only write path is through a Netlify Function with the
-- service_role key. Reading happens from the dashboard only.
-- Changing permissions? Run this file again in the SQL Editor — the file in the
-- repo changes nothing by itself.
-- ============================================================

create table if not exists public.survey_events (
  id             bigint generated always as identity primary key,
  event_uid      uuid not null unique,          -- an id from the client: a retry creates no duplicate
  session_id     uuid not null,
  survey_version text not null,
  event_type     text not null check (event_type in
                   ('session_start','screen_view','answer','complete','screenout','quotafull')),
  screen_id      text,
  payload        jsonb not null default '{}'::jsonb,
  client_ts      timestamptz,                   -- the client's clock (unreliable, for analysis only)
  created_at     timestamptz not null default now()
);

-- create table if not exists does not touch an existing table, so extending the
-- list of types requires replacing the constraint explicitly. Postgres gives an
-- anonymous check exactly this name, so an older installation is updated too when
-- the file is re-run.
-- ⚠ Kept in sync with EventType in src/data/events.ts and with EVENT_TYPES in
-- events.mts.
alter table public.survey_events drop constraint if exists survey_events_event_type_check;
alter table public.survey_events add constraint survey_events_event_type_check
  check (event_type in ('session_start','screen_view','answer','complete','screenout','quotafull'));

create index if not exists survey_events_session_idx on public.survey_events (session_id, created_at);
create index if not exists survey_events_type_idx    on public.survey_events (event_type);
create index if not exists survey_events_screen_idx  on public.survey_events (survey_version, screen_id);

-- RLS on, with no policy at all: anon and authenticated are blocked completely.
-- The Netlify Function writes with service_role, which bypasses RLS by design —
-- and so the validation is enforced in the function itself
-- (netlify/functions/events.mts).
alter table public.survey_events enable row level security;

drop policy if exists survey_events_insert_anon on public.survey_events;
revoke all on public.survey_events from anon, authenticated;

-- ============================================================
-- Dynamic surveys: the list of surveys, a draft per survey, and published
-- versions. The browser never reaches these tables directly — everything goes
-- through Netlify Functions:
--   config-get (a public read), admin-surveys / admin-draft / admin-publish
--   (first-edea editors only).
-- ============================================================

-- A survey = a slug (its id in the public link /s/<slug>) + a display name.
-- A real delete is allowed only for a survey never published — the FK from
-- survey_configs (with no cascade) blocks deleting a survey that has versions,
-- because events point at them.
-- A survey that has been published is "deleted" by archiving: archived_at stops
-- it being served to new sessions, while a link to a pinned version keeps working
-- until the respondents in the middle have finished.
-- ⚠ The slug pattern is duplicated in src/data/surveys.ts (SURVEY_SLUG_RE).
create table if not exists public.surveys (
  slug        text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  archived_at timestamptz
);

-- One draft per survey (a single editor per survey)
create table if not exists public.survey_drafts (
  survey_id  text primary key references public.surveys(slug) on delete cascade,
  config     jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

-- The migration from the single-survey model (survey_drafts.id = 1): the existing
-- draft moves to the default survey 'main', which is also what / keeps serving to
-- old links.
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

-- Published versions — immutable and append-only. A respondent's session is
-- pinned to the version it started on, so a published version must never change.
-- version stays a single, global key (survey_events refers to it through one
-- column), which is why it carries the slug inside it: 2026-08-08.1-<slug>.
create table if not exists public.survey_configs (
  version      text primary key,
  survey_id    text not null references public.surveys(slug),
  config       jsonb not null,
  published_at timestamptz not null default now(),
  published_by text not null
);

-- The backfill below is an UPDATE — the trigger that blocks changes has to come
-- down before it (and go straight back up after).
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

-- Immutability enforced at the DB level (defence in depth — service_role is blocked too)
create or replace function public.reject_config_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'survey_configs is append-only';
end;
$$;

create trigger survey_configs_immutable
  before update or delete on public.survey_configs
  for each row execute function public.reject_config_mutation();

-- The same permissions posture as survey_events: RLS on, zero policies
alter table public.surveys        enable row level security;
alter table public.survey_drafts  enable row level security;
alter table public.survey_configs enable row level security;
revoke all on public.surveys        from anon, authenticated;
revoke all on public.survey_drafts  from anon, authenticated;
revoke all on public.survey_configs from anon, authenticated;

-- ============================================================
-- Explicit grants for service_role (Netlify's server side only).
-- In older cloud projects service_role got everything through default privileges;
-- in new installations — and in supabase start's local stack too — objects are
-- not exposed automatically, so the grants here are explicit. anon/authenticated
-- stay blocked completely.
-- survey_configs deliberately has no update/delete — the trigger above enforces
-- append-only.
-- ============================================================
grant usage on schema public to service_role;
grant select, insert                 on public.survey_events  to service_role;
grant select, insert, update, delete on public.surveys        to service_role;
grant select, insert, update, delete on public.survey_drafts  to service_role;
grant select, insert                 on public.survey_configs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ============================================================
-- Views for analysis (reachable only from the dashboard / with the service key)
-- Defined after survey_configs because they lean on it to translate
-- survey_version — the only identifier an event row carries — into the survey it
-- belongs to.
-- ============================================================

-- One complete response per row — for CSV export.
-- The end events are complete / screenout / quotafull; outcome preserves the
-- distinction between them, so a genuine screenout is never mixed up with a full
-- quota.
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

-- The per-screen funnel: views, answers, average time — for quality control and drop-off
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
-- Statistics for the console's stats screen (ENG-12..ENG-18)
-- Layer 1: session_stats — one summary row per session.
--
-- A "test session" = session_start's vars contain url_test (a link opened with
-- ?test=1). This is the single point where that rule is defined — every
-- statistics function filters through it, and the admin console can ask for
-- include_test to see them as well.
--
-- Effective vars = from the last event that carries vars: an end event beats an
-- enriched answer, which beats session_start. A session abandoned by an older
-- client (with no vars on answer) is left with its initial vars — a computed
-- variable like segment will show up as "unknown" for it.
-- ⚠ The url_test rule and the names here are kept in sync with
-- tests/sync/stats-sql.test.ts.
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

-- Layer 2: the aggregation functions the authenticated endpoint (admin-stats)
-- calls through rpc.
-- drop before create — changing a signature or the returned columns fails under
-- create or replace, and the explicit drop keeps the file re-runnable.

-- The overview tiles: total, completed, screened out, quota full, and
-- abandonment split in two — "abandoned mid-survey" (answered at least once)
-- versus "arrived and never answered" (bots / a glance).
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

-- The per-screen funnel: viewed, answered, dropped-here (the last view of a
-- session with no end event), and the median first-attempt time only — a repeat
-- answer after going back is an order of magnitude faster and would drag the
-- median down. End screens do not appear: they have no screen_view.
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
    -- The last view of each session that never reached an end event = the screen it disappeared on
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

-- The final answer: one row per session×screen — the event with the highest
-- attempt (ties broken by time). Someone who went back and changed their answer
-- is counted once, with what they chose in the end. value stays raw jsonb — the
-- interpretation (atoms, labels) happens in the layers above.
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

-- Distributions: one atom-expansion rule for every kind of closed question —
--   string/number/boolean → one atom (the value itself as text)
--   array (multi-choice)  → an atom per option selected
--   object (matrix)       → an atom per item, item_id = the item, the key = the
--                            rating or na
--   null (a deliberate skip) → not an atom; counted in the open-answer statistics
--                            only
-- The breakdown (p_by): an effective session variable name, or _outcome for the
-- session's outcome. A session with no value for the dimension gets
-- dim_value=null — "unknown" in the display, never discarded.
-- The result: raw counts by (screen, item, key, dimension) — labels and
-- percentages are the browser's job.
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

-- The percentage bases for a breakdown: how many sessions answered (a final
-- answer that is not null) on each screen, within each dimension value — the
-- denominator of the share-of-respondents-in-the-group percentages. The same
-- filters as above.
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

-- Open-text answers, the metadata that requires no reading: the three states —
-- answered (a final answer that is not null), deliberately skipped (a final answer
-- of null), abandoned (viewed the screen and never answered) — and the answer
-- length percentiles. No content analysis: lengths and counts only.
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

-- The list itself: raw text answers, newest first, paged. The browser tells us
-- which screens are text questions (SQL has no notion of screen types — the config
-- lives in the browser).
-- p_dim:   which session variable to report and filter by — any mark or draw.
--          It used to be hardcoded to 'segment', the name the research
--          questionnaire happens to use; a survey built in the console names its
--          marks mark1, mark2… so the filter offered no values, every row read as
--          unknown, and picking "unknown" returned everything. It looked like the
--          personas had never been recorded.
-- p_value: the value to keep; __unknown__ = sessions with no value for p_dim;
--          null = everything.
drop function if exists public.open_answers(text, text, boolean, text[], text, int, int);
drop function if exists public.open_answers(text, text, boolean, text[], text, text, int, int);
create function public.open_answers(
  p_survey text, p_version text, p_include_test boolean,
  p_screens text[], p_dim text, p_value text, p_limit int, p_offset int
)
returns table (
  total          bigint,
  screen_id      text,
  value          text,
  created_at     timestamptz,
  survey_version text,
  dim_value      text,
  outcome        text
)
language sql stable
set search_path = public
as $$
  with s as (
    select session_id, outcome,
           case when p_dim is null then null else vars ->> p_dim end as dim_value
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
    s.dim_value,
    coalesce(s.outcome, 'abandoned') as outcome
  from final_answers f
  join s using (session_id)
  where (p_version is null or f.survey_version = p_version)
    and f.screen_id = any (p_screens)
    and jsonb_typeof(f.value) = 'string'
    and (p_dim is null or p_value is null
         or (p_value = '__unknown__' and s.dim_value is null)
         or s.dim_value = p_value)
  order by f.created_at desc
  limit p_limit offset p_offset
$$;

revoke execute on function public.open_answers(text, text, boolean, text[], text, text, int, int) from public, anon, authenticated;
grant execute on function public.open_answers(text, text, boolean, text[], text, text, int, int) to service_role;

-- Quotas: how many respondents *finished* with each mark value. This is the only
-- function here a public endpoint calls (quota-get, with no authentication) — which
-- is why it takes an explicit list of marks and returns counts for those alone,
-- rather than an open window onto respondents' vars.
--
-- 'complete' only: a screenout is not a persona we collected, and someone already
-- sent to the quota-full screen must not be counted twice. Test sessions are
-- excluded through session_stats — without that our own ?test=1 clicks would close
-- the real study's quotas.
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
-- Defence in depth: blocking the creation of accounts outside first-edea.com
-- This hook runs before a user is created in Supabase Auth, so a Google account
-- from another domain is never created at all (instead of being created and then
-- getting a 403).
--
-- An additional layer only — the real enforcement is the domain check in
-- requireAdmin (netlify/functions/lib/session.ts), which runs on every request.
--
-- ⚠️ The SQL alone enables nothing: the function has to be registered in the dashboard under
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

-- Only the Auth machinery may execute the hook
grant execute on function public.restrict_signup_to_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.restrict_signup_to_domain(jsonb) from anon, authenticated, public;
