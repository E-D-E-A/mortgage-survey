// ENG-18: breaking distributions down by a dimension — an effective session
// variable or the session's outcome.
// A session abandoned by an older client (with no vars on the answer events) is
// "unknown" (null).
// The expectations were worked out by hand. Runs only with DB_TESTS=1 against the
// local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  createAdminUser,
  dbTestsEnabled,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  signIn,
  type Sql,
} from './harness';
import { ensureSurvey, idFactory, resetEvents, sessionEvents } from './fixtures';

const V = '2026-08-01.1-bdtest';
const ids = idFactory('d4');

// s1: complete, segment A (at the end), q1=x · s2: complete, segment B, q1=y
// s3: abandoned, an older client — no vars on the answers ⇒ an unknown dimension;
//     url_source=fb is known from the start
// s4: screenout, segment A, q1=x · s5: a test session, segment A, q1=x — excluded
const fixture = [
  ...sessionEvents(ids, 1, V, {
    startVars: { url_source: 'panel' },
    steps: [{ screen: 'q1', answer: 'x', vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A', url_source: 'panel' } },
  }),
  ...sessionEvents(ids, 2, V, {
    startVars: { url_source: 'panel' },
    steps: [{ screen: 'q1', answer: 'y', vars: { segment: 'B' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'B', url_source: 'panel' } },
  }),
  ...sessionEvents(ids, 3, V, {
    startVars: { url_source: 'fb' },
    steps: [{ screen: 'q1', answer: 'x' }],
  }),
  ...sessionEvents(ids, 4, V, {
    startVars: { url_source: 'fb' },
    steps: [{ screen: 'q1', answer: 'x', vars: { segment: 'A' } }],
    terminal: 'screenout',
    terminalPayload: { vars: { segment: 'A', url_source: 'fb' } },
  }),
  ...sessionEvents(ids, 5, V, {
    startVars: { url_test: '1', url_source: 'panel' },
    steps: [{ screen: 'q1', answer: 'x', vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
];

describe.runIf(dbTestsEnabled)('stats_distributions with a dimension (ENG-18)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'bdtest', 'שאלון פילוח', [{ version: V }]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('splits counts by an effective session var; sessions without it land in null', async () => {
    const rows = await sql`
      select * from stats_distributions('bdtest', null, false, 'segment')
      order by answer_key, dim_value nulls last`;
    expect(rows).toEqual([
      expect.objectContaining({ answer_key: 'x', dim_value: 'A', n: 2 }),
      expect.objectContaining({ answer_key: 'x', dim_value: null, n: 1 }),
      expect.objectContaining({ answer_key: 'y', dim_value: 'B', n: 1 }),
    ]);
  });

  it('a var known from session_start splits drop-offs too', async () => {
    const rows = await sql`
      select * from stats_distributions('bdtest', null, false, 'url_source')
      order by answer_key, dim_value`;
    expect(rows).toEqual([
      expect.objectContaining({ answer_key: 'x', dim_value: 'fb', n: 2 }),
      expect.objectContaining({ answer_key: 'x', dim_value: 'panel', n: 1 }),
      expect.objectContaining({ answer_key: 'y', dim_value: 'panel', n: 1 }),
    ]);
  });

  it('the reserved _outcome dimension groups by session result', async () => {
    const rows = await sql`
      select * from stats_distributions('bdtest', null, false, '_outcome')
      order by answer_key, dim_value`;
    expect(rows).toEqual([
      expect.objectContaining({ answer_key: 'x', dim_value: 'abandoned_mid', n: 1 }),
      expect.objectContaining({ answer_key: 'x', dim_value: 'complete', n: 1 }),
      expect.objectContaining({ answer_key: 'x', dim_value: 'screenout', n: 1 }),
      expect.objectContaining({ answer_key: 'y', dim_value: 'complete', n: 1 }),
    ]);
  });

  it('without a dimension the shape stays as before (dim_value null everywhere)', async () => {
    const rows = await sql`
      select * from stats_distributions('bdtest', null, false)
      order by answer_key`;
    expect(rows).toEqual([
      expect.objectContaining({ answer_key: 'x', dim_value: null, n: 3 }),
      expect.objectContaining({ answer_key: 'y', dim_value: null, n: 1 }),
    ]);
  });

  it('stats_bases returns per-dimension answer bases for percent denominators', async () => {
    const rows = await sql`
      select * from stats_bases('bdtest', null, false, 'segment')
      order by dim_value nulls last`;
    expect(rows).toEqual([
      expect.objectContaining({ screen_id: 'q1', dim_value: 'A', answered: 2 }),
      expect.objectContaining({ screen_id: 'q1', dim_value: 'B', answered: 1 }),
      expect.objectContaining({ screen_id: 'q1', dim_value: null, answered: 1 }),
    ]);
  });

  it('the endpoint passes by= through and bundles the bases', async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    await createAdminUser('stats-admin@first-edea.com');
    const token = await signIn('stats-admin@first-edea.com');
    const { default: handler } = await import('../../netlify/functions/admin-stats.mts');
    const res = await handler(
      new Request('http://localhost/.netlify/functions/admin-stats?survey=bdtest&by=segment', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.by).toBe('segment');
    expect(body.distributions.some((r: { dim_value: string | null }) => r.dim_value === 'A')).toBe(true);
    expect(body.bases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ screen_id: 'q1', dim_value: 'A', answered: 2 }),
      ]),
    );
    const bad = await handler(
      new Request('http://localhost/.netlify/functions/admin-stats?survey=bdtest&by=no such!', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(bad.status).toBe(400);
  });
});
