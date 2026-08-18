// ENG-13: the per-session summary layer and the stats_overview tiles function,
// and above them the authenticated admin-stats endpoint. Runs only with
// DB_TESTS=1 against the local stack.
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

const V1 = '2026-08-01.1-ovtest';
const V2 = '2026-08-05.2-ovtest';
const ids = idFactory('a1');

// A hand-computed fixture — a source of truth independent of the implementation:
//   s1 complete v1 · s2 complete v2 · s3 screenout v1 · s4 quotafull v2
//   s5 abandoned mid-survey on v1 (answered, then vanished) · s6 arrived and never
//   answered on v2 · s7 complete on v1, marked as a test
const fixture = [
  ...sessionEvents(ids, 1, V1, { steps: [{ screen: 'q1', answer: 'yes' }], terminal: 'complete' }),
  ...sessionEvents(ids, 2, V2, { steps: [{ screen: 'q1', answer: 'no' }], terminal: 'complete' }),
  ...sessionEvents(ids, 3, V1, { steps: [{ screen: 'q1', answer: 'none' }], terminal: 'screenout' }),
  ...sessionEvents(ids, 4, V2, { steps: [{ screen: 'q1', answer: 'yes' }], terminal: 'quotafull' }),
  ...sessionEvents(ids, 5, V1, { steps: [{ screen: 'q1', answer: 'maybe' }] }),
  ...sessionEvents(ids, 6, V2, { steps: [{ screen: 'q1' }] }),
  ...sessionEvents(ids, 7, V1, { startVars: { url_test: '1' }, steps: [{ screen: 'q1', answer: 'yes' }], terminal: 'complete' }),
];

describe.runIf(dbTestsEnabled)('stats_overview (ENG-13)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'ovtest', 'שאלון אריחים', [{ version: V1 }, { version: V2 }]);
    await resetEvents(sql, [V1, V2], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  const overview = async (version: string | null, includeTest = false) => {
    const rows = await sql`select * from stats_overview(${'ovtest'}, ${version}, ${includeTest})`;
    return rows[0];
  };

  it('counts every tile over all versions, excluding test sessions by default', async () => {
    const o = await overview(null);
    expect(o).toMatchObject({
      total_sessions: 6,
      completed: 2,
      screened_out: 1,
      quota_full: 1,
      abandoned_mid: 1,
      abandoned_bounce: 1,
    });
  });

  it('includes test sessions only when asked', async () => {
    const o = await overview(null, true);
    expect(o.total_sessions).toBe(7);
    expect(o.completed).toBe(3);
  });

  it('narrows to a single version', async () => {
    const o = await overview(V1);
    expect(o).toMatchObject({ total_sessions: 3, completed: 1, screened_out: 1, abandoned_mid: 1 });
  });
});

describe.runIf(dbTestsEnabled)('admin-stats endpoint (ENG-13)', () => {
  let sql: Sql;
  let token: string;

  const call = async (query: string, auth?: string) => {
    const { default: handler } = await import('../../netlify/functions/admin-stats.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(new Request(`http://localhost/.netlify/functions/admin-stats?${query}`, { headers }));
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'ovtest', 'שאלון אריחים', [{ version: V1 }, { version: V2 }]);
    await resetEvents(sql, [V1, V2], fixture);
    await createAdminUser('stats-admin@first-edea.com');
    await createAdminUser('outsider@gmail.com');
    token = await signIn('stats-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('rejects a missing token with 401', async () => {
    const res = await call('survey=ovtest');
    expect(res.status).toBe(401);
  });

  it('rejects a confirmed user outside the domain with 403', async () => {
    const outsider = await signIn('outsider@gmail.com');
    const res = await call('survey=ovtest', outsider);
    expect(res.status).toBe(403);
  });

  it('returns the overview bundle, fresh (no-store)', async () => {
    const res = await call('survey=ovtest', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.survey).toBe('ovtest');
    expect(body.versions.map((v: { version: string }) => v.version)).toEqual([V2, V1]);
    expect(body.overview).toMatchObject({
      total_sessions: 6,
      completed: 2,
      screened_out: 1,
      quota_full: 1,
      abandoned_mid: 1,
      abandoned_bounce: 1,
    });
  });

  it('honors version= and include_test=', async () => {
    const single = await (await call(`survey=ovtest&version=${V1}`, token)).json();
    expect(single.overview.total_sessions).toBe(3);
    const withTest = await (await call('survey=ovtest&include_test=1', token)).json();
    expect(withTest.overview.total_sessions).toBe(7);
  });

  it('400 on malformed params, 404 on unknown survey, 405 on POST', async () => {
    expect((await call('survey=NOT_A_SLUG!', token)).status).toBe(400);
    expect((await call('survey=ovtest&version=no-such-version', token)).status).toBe(400);
    expect((await call('survey=no-such-survey', token)).status).toBe(404);
    const { default: handler } = await import('../../netlify/functions/admin-stats.mts');
    const res = await handler(
      new Request('http://localhost/.netlify/functions/admin-stats?survey=ovtest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(405);
  });
});
