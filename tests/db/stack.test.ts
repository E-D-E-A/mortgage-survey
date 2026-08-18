// Integration tests against the local Supabase (ENG-12). They do not run under a
// plain `npm test`: they need a running stack (`npx supabase start`) and an
// explicit flag —
//   bash:        DB_TESTS=1 npx vitest run tests/db
//   PowerShell:  $env:DB_TESTS='1'; npx vitest run tests/db
// Without the flag the suite is skipped (and green) — CI stays free of Docker.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, connectLocal, dbTestsEnabled, type Sql } from './harness';

// A fixed session_id for the fixture — the test deletes and re-inserts its own
// events, so a re-run against a live stack accumulates no duplicates.
const SID = '11111111-1111-4111-8111-111111111111';
const VERSION = '2026-08-01.1-ittest';

const uid = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

describe.runIf(dbTestsEnabled)('local Supabase stack', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    // Twice deliberately: schema.sql is declared idempotent — a second run has to pass cleanly
    await applySchema(sql);
    await applySchema(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('round-trips a completed session through the completed_responses view', async () => {
    await sql`insert into surveys (slug, name, created_by) values ('ittest', 'שאלון בדיקה', 'test')
              on conflict (slug) do nothing`;
    await sql`insert into survey_configs (version, survey_id, config, published_by)
              values (${VERSION}, 'ittest', ${sql.json({ version: VERSION, screens: [] })}, 'test')
              on conflict (version) do nothing`;
    await sql`delete from survey_events where session_id = ${SID}`;

    await sql`insert into survey_events (event_uid, session_id, survey_version, event_type, screen_id, payload)
              values
      (${uid(1)}, ${SID}, ${VERSION}, 'session_start', null, ${sql.json({ vars: { url_source: 'it' } })}),
      (${uid(2)}, ${SID}, ${VERSION}, 'screen_view', 'q1', ${sql.json({ index: 0, attempt: 1 })}),
      (${uid(3)}, ${SID}, ${VERSION}, 'answer', 'q1', ${sql.json({ value: 'yes', ms: 1200, attempt: 1 })}),
      (${uid(4)}, ${SID}, ${VERSION}, 'complete', 'end', ${sql.json({ variant: 'complete', answers: { q1: 'yes' }, vars: {} })})`;

    const rows = await sql`select outcome, survey_id from completed_responses where session_id = ${SID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('complete');
    expect(rows[0].survey_id).toBe('ittest');
  });

  it('the pre-existing screen_funnel view still aggregates, untouched by the stats layer', async () => {
    // ENG-13 added session_stats and its test-session rule beside this view
    // rather than inside it. Counting both sessions here — the marked one
    // included — is the assertion: "existing views untouched" has to mean the
    // view still behaves exactly as it did, not merely that it still parses.
    const SF = '2026-08-01.1-sftest';
    const sid = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
    const eid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;

    await sql`insert into surveys (slug, name, created_by) values ('sftest', 'שאלון משפך', 'test')
              on conflict (slug) do nothing`;
    await sql`insert into survey_configs (version, survey_id, config, published_by)
              values (${SF}, 'sftest', ${sql.json({ version: SF, screens: [] })}, 'test')
              on conflict (version) do nothing`;
    await sql`delete from survey_events where survey_version = ${SF}`;
    await sql`insert into survey_events (event_uid, session_id, survey_version, event_type, screen_id, payload)
              values
      (${eid(1)}, ${sid(1)}, ${SF}, 'session_start', null, ${sql.json({ vars: {} })}),
      (${eid(2)}, ${sid(1)}, ${SF}, 'screen_view', 'q1', ${sql.json({ index: 0, attempt: 1 })}),
      (${eid(3)}, ${sid(1)}, ${SF}, 'answer', 'q1', ${sql.json({ value: 'yes', ms: 1200, attempt: 1 })}),
      (${eid(4)}, ${sid(2)}, ${SF}, 'session_start', null, ${sql.json({ vars: { url_test: '1' } })}),
      (${eid(5)}, ${sid(2)}, ${SF}, 'screen_view', 'q1', ${sql.json({ index: 0, attempt: 1 })}),
      (${eid(6)}, ${sid(2)}, ${SF}, 'answer', 'q1', ${sql.json({ value: 'no', ms: 2000, attempt: 1 })})`;

    const rows = await sql`
      select * from screen_funnel where survey_version = ${SF} and screen_id = 'q1'`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].sessions_viewed)).toBe(2);
    expect(Number(rows[0].sessions_answered)).toBe(2);
    expect(Number(rows[0].avg_ms_on_screen)).toBe(1600);
    expect(Number(rows[0].median_ms_on_screen)).toBe(1600);
  });

  it('re-applying the schema over a live database leaves the data and the functions working', async () => {
    // beforeAll already applies it twice, but both times against an empty
    // database — which only ever proved the DDL parses. The risk worth covering
    // is the drop/create pass running over a database that holds real rows.
    const IV = '2026-08-01.1-idem';
    const sid = '55555555-5555-4555-8555-555555555555';
    const eid = (n: number) => `66666666-6666-4666-8666-${String(n).padStart(12, '0')}`;

    await sql`insert into surveys (slug, name, created_by) values ('idem', 'שאלון חזרה', 'test')
              on conflict (slug) do nothing`;
    await sql`insert into survey_configs (version, survey_id, config, published_by)
              values (${IV}, 'idem', ${sql.json({ version: IV, screens: [] })}, 'test')
              on conflict (version) do nothing`;
    await sql`delete from survey_events where survey_version = ${IV}`;
    await sql`insert into survey_events (event_uid, session_id, survey_version, event_type, screen_id, payload)
              values
      (${eid(1)}, ${sid}, ${IV}, 'session_start', null, ${sql.json({ vars: {} })}),
      (${eid(2)}, ${sid}, ${IV}, 'screen_view', 'q1', ${sql.json({ index: 0, attempt: 1 })}),
      (${eid(3)}, ${sid}, ${IV}, 'answer', 'q1', ${sql.json({ value: 'yes', ms: 900, attempt: 1 })}),
      (${eid(4)}, ${sid}, ${IV}, 'complete', 'end', ${sql.json({ variant: 'complete', answers: {}, vars: {} })})`;

    await applySchema(sql);

    const kept = await sql`select outcome from completed_responses where session_id = ${sid}`;
    expect(kept).toHaveLength(1);
    const [tiles] = await sql`select * from stats_overview('idem', ${IV}, false)`;
    expect(tiles).toMatchObject({ total_sessions: 1, completed: 1 });
  });
});

// ── what the seed actually produces (ENG-12) ──
//
// "More than 50 sessions" was the whole assertion, and the ticket promised five
// specific properties. The generator is a seeded PRNG (mulberry32(42)), so the
// index-driven counts below are exact and reproducible; the two properties driven
// by a weighted draw are asserted as presence only, which is what can be claimed
// honestly without re-running the generator by hand.

describe.runIf(dbTestsEnabled)('the demo seed (ENG-12)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    const { seedDemo } = await import('../../scripts/seed-stats.mjs');
    await seedDemo(sql);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('populates a browsable amount of sessions', async () => {
    const [{ n }] = await sql`
      select count(distinct session_id)::int as n
      from survey_events where survey_version like '%-demo'`;
    expect(n).toBeGreaterThan(50);
  });

  it('produces every outcome, including both kinds of abandonment', async () => {
    const [row] = await sql`
      select
        count(*) filter (where outcome = 'complete')::int                     as complete,
        count(*) filter (where outcome = 'screenout')::int                    as screenout,
        count(*) filter (where outcome = 'quotafull')::int                    as quotafull,
        count(*) filter (where outcome is null and answered_any)::int         as abandoned_mid,
        count(*) filter (where outcome is null and not answered_any)::int     as abandoned_bounce
      from session_stats where survey_id = 'demo'`;
    for (const [name, n] of Object.entries(row)) {
      expect(Number(n), `the seed produced no ${name} sessions`).toBeGreaterThan(0);
    }
  });

  it('represents all three segments', async () => {
    const rows = await sql`
      select distinct vars ->> 'segment' as segment from session_stats
      where survey_id = 'demo' and vars ? 'segment' order by 1`;
    expect(rows.map((r) => r.segment)).toEqual(['A', 'B', 'C']);
  });

  it('includes sessions that went back and answered again', async () => {
    // Five of them, by index rather than by chance — these are what keep the
    // funnel's first-attempt median honest.
    const [{ n }] = await sql`
      select count(*)::int as n from survey_events
      where survey_version like '%-demo' and event_type = 'answer'
        and screen_id = 's_status' and (payload ->> 'attempt')::int = 2`;
    expect(n).toBe(5);
  });

  it('includes respondents who deliberately skipped the open question', async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from survey_events
      where survey_version like '%-demo' and event_type = 'answer'
        and screen_id = 'why' and payload -> 'value' = 'null'::jsonb`;
    expect(n).toBeGreaterThan(0);
  });

  it('marks exactly six sessions as test sessions', async () => {
    const [{ n }] = await sql`
      select count(*)::int as n from session_stats where survey_id = 'demo' and is_test`;
    expect(n).toBe(6);
  });
});
