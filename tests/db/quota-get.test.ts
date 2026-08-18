// ENG-21: the completion counts behind the quotas — the quota_counts SQL and the
// public quota-get endpoint above it.
//
// This is the only statistics endpoint with no authentication, and until now it
// had no test of any kind. Two of its rules are load-bearing and invisible when
// they break: only completed sessions count, and our own ?test=1 sessions never
// do. Getting either wrong closes a real study's quotas early and starts turning
// respondents away, with nothing anywhere reporting an error.
//
// Runs only with DB_TESTS=1 against the local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  dbTestsEnabled,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  type Sql,
} from './harness';
import { ensureSurvey, idFactory, resetEvents, sessionEvents } from './fixtures';

const V = '2026-08-01.1-qtest';
const V_NONE = '2026-08-01.1-qnone';
const ids = idFactory('ab');

/** persona is capped; owner is a real value with no ceiling, and must never be published. */
const config = {
  version: V,
  varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 50 } } },
  screens: [
    { id: 'q1', type: 'info', title: 'שאלה', body: '' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה', body: '' },
    { id: 'end_quotafull', type: 'end', variant: 'quotafull', title: 'מלא', body: '' },
  ],
};

// Only s1 and s2 may ever be counted:
//   s1, s2 finished as young_couple · s3 finished as owner (no ceiling)
//   s4 screened out · s5 sent to the quota-full screen · s6 abandoned
//   s7 a ?test=1 session that finished · s8 finished with no persona at all
//   s9 finished carrying persona explicitly set to null
const persona = (value: unknown) => ({ vars: { persona: value } });
const fixture = [
  ...sessionEvents(ids, 1, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete', terminalPayload: persona('young_couple') }),
  ...sessionEvents(ids, 2, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete', terminalPayload: persona('young_couple') }),
  ...sessionEvents(ids, 3, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete', terminalPayload: persona('owner') }),
  ...sessionEvents(ids, 4, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'screenout', terminalPayload: persona('young_couple') }),
  ...sessionEvents(ids, 5, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'quotafull', terminalPayload: persona('young_couple') }),
  ...sessionEvents(ids, 6, V, { steps: [{ screen: 'q1', answer: 'a', vars: { persona: 'young_couple' } }] }),
  ...sessionEvents(ids, 7, V, { startVars: { url_test: '1' }, steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete', terminalPayload: persona('young_couple') }),
  ...sessionEvents(ids, 8, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete' }),
  ...sessionEvents(ids, 9, V, { steps: [{ screen: 'q1', answer: 'a' }], terminal: 'complete', terminalPayload: persona(null) }),
];

describe.runIf(dbTestsEnabled)('quota_counts (ENG-21)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'qtest', 'שאלון מכסות', [{ version: V, config }]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  const counts = () => sql`select * from quota_counts('qtest', array['persona'])`;

  it('counts the sessions that finished, grouped by mark and value', async () => {
    const rows = await counts();
    expect(rows.find((r) => r.value === 'young_couple')).toMatchObject({ mark: 'persona', n: 2 });
    expect(rows.find((r) => r.value === 'owner')).toMatchObject({ mark: 'persona', n: 1 });
  });

  it('a screenout, a quota-full and an abandoned session are all uncounted', async () => {
    // Three ways to reach the end of a session without being a respondent we
    // collected. Counting any of them fills the quota with people the study
    // never got, and closes it early.
    const rows = await counts();
    expect(rows.find((r) => r.value === 'young_couple')!.n).toBe(2);
  });

  it('a ?test=1 session does not count towards a quota', async () => {
    // s7 finished as a young_couple exactly like s1 and s2. If it were counted
    // the number above would be 3, and our own testing would be closing the
    // study's cells.
    const rows = await counts();
    expect(rows.find((r) => r.value === 'young_couple')!.n).toBe(2);
  });

  it('a session that finished without the mark at all produces no row for it', async () => {
    // s8's vars have no persona key, so there is no cell it could count into.
    const rows = await counts();
    expect(rows.reduce((total, r) => total + r.n, 0)).toBe(4); // 2 young_couple + 1 owner + 1 null
  });

  it('a mark recorded as null is its own row — the caller is what drops it', async () => {
    const rows = await counts();
    expect(rows.find((r) => r.value === null)).toMatchObject({ mark: 'persona', n: 1 });
  });

  it('a mark nobody ever set comes back empty rather than failing', async () => {
    const rows = await sql`select * from quota_counts('qtest', array['nosuchmark'])`;
    expect(rows).toHaveLength(0);
  });
});

describe.runIf(dbTestsEnabled)('quota-get endpoint (ENG-21)', () => {
  let sql: Sql;

  const call = async (query: string, method = 'GET') => {
    const { default: handler } = await import('../../netlify/functions/quota-get.mts');
    return handler(
      new Request(`http://localhost/.netlify/functions/quota-get${query ? `?${query}` : ''}`, {
        method,
      }),
    );
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'qtest', 'שאלון מכסות', [{ version: V, config }]);
    await ensureSurvey(sql, 'qnone', 'שאלון בלי מכסות', [
      { version: V_NONE, config: { version: V_NONE, varMeta: { persona: { label: 'פרסונה' } }, screens: [] } },
    ]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('publishes the counts for capped values and nothing else', async () => {
    // owner has completions too, and no ceiling. Publishing it would turn an
    // unauthenticated endpoint into a window onto how the sample is breaking
    // down — which is not what a respondent's browser needs to know.
    const res = await call('survey=qtest');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ persona: { young_couple: 2 } });
    expect(body.version).toBe(V);
  });

  it('drops the null-valued row rather than passing it on as a cell', async () => {
    const body = await (await call('survey=qtest')).json();
    expect(Object.keys(body.counts.persona)).toEqual(['young_couple']);
  });

  it('a survey that has never been published simply has no quotas', async () => {
    const res = await call('survey=never-published');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ survey: 'never-published', version: null, counts: {} });
  });

  it('a published survey with no quotas reports its version and no counts', async () => {
    const body = await (await call('survey=qnone')).json();
    expect(body).toEqual({ survey: 'qnone', version: V_NONE, counts: {} });
  });

  it('caches briefly — the count is approximate anyway, and entry traffic arrives in bursts', async () => {
    const res = await call('survey=qtest');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
  });

  it('rejects a malformed slug and a non-GET method', async () => {
    expect((await call('survey=NOT_A_SLUG!')).status).toBe(400);
    expect((await call('survey=qtest', 'POST')).status).toBe(405);
  });
});
