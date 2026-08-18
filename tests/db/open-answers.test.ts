// ENG-16: paging through open-text answers — the three states (answered/skipped/
// abandoned), length percentiles, and a newest-first paged list with filtering.
// The expectations were worked out by hand. Runs only with DB_TESTS=1.
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

const V = '2026-08-01.1-oatest';
const ids = idFactory('f6');

// why (text): s1 answered at length · s2 answered briefly · s3 skipped (null) ·
// s4 viewed and abandoned · s5 a test session with an answer — excluded · s6
// answered, segment B
const LONG = 'הריבית מפחידה אותי ואני לא מבין את המסלולים בכלל';
const fixture = [
  ...sessionEvents(ids, 1, V, {
    steps: [{ screen: 'why', answer: LONG, vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 2, V, {
    steps: [{ screen: 'why', answer: 'ההחזר', vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 3, V, {
    steps: [{ screen: 'why', answer: null, vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 4, V, { steps: [{ screen: 'why' }] }),
  ...sessionEvents(ids, 5, V, {
    startVars: { url_test: '1' },
    steps: [{ screen: 'why', answer: 'בדיקה', vars: { segment: 'A' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 6, V, {
    steps: [{ screen: 'why', answer: 'הבירוקרטיה', vars: { segment: 'B' } }],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'B' } },
  }),
  // why2 (text): four answers whose lengths are chosen so that the interpolating
  // percentile and the discrete one disagree — see the percentile test below
  ...[2, 4, 6, 10].map((len, i) =>
    sessionEvents(ids, 7 + i, V, {
      steps: [{ screen: 'why2', answer: 'x'.repeat(len) }],
      terminal: 'complete',
    }),
  ).flat(),
];

/** 51 answers on a screen of their own — enough to see where the default page ends. */
const bulkFixture = Array.from({ length: 51 }, (_, i) =>
  sessionEvents(ids, 100 + i, V, {
    steps: [{ screen: 'bulk', answer: `answer-${i}` }],
    terminal: 'complete',
  }),
).flat();

describe.runIf(dbTestsEnabled)('open answers SQL (ENG-16)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'oatest', 'שאלון פתוחות', [{ version: V }]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('splits the three states and measures lengths without reading content', async () => {
    const rows = await sql`select * from open_answer_stats('oatest', null, false, 'why')`;
    expect(rows).toHaveLength(1);
    const s = rows[0];
    expect(s).toMatchObject({ screen_id: 'why', answered: 3, skipped: 1, abandoned: 1 });
    expect(s.len_min).toBe('ההחזר'.length);
    expect(s.len_max).toBe(LONG.length);
  });

  it('lists raw answers newest-first with session context, paginated', async () => {
    const page = await sql`
      select * from open_answers('oatest', null, false, array['why'], 'segment', null, 2, 0)`;
    expect(page).toHaveLength(2);
    expect(Number(page[0].total)).toBe(3);
    // Newest first: s6 was seeded last (a larger atBase)
    expect(page[0].value).toBe('הבירוקרטיה');
    expect(page[0].dim_value).toBe('B');
    expect(page[0].outcome).toBe('complete');
    const rest = await sql`
      select * from open_answers('oatest', null, false, array['why'], 'segment', null, 2, 2)`;
    expect(rest).toHaveLength(1);
  });

  it('filters by any named dimension, including the explicit unknown bucket', async () => {
    const b = await sql`
      select * from open_answers('oatest', null, false, array['why'], 'segment', 'B', 50, 0)`;
    expect(b.map((r) => r.value)).toEqual(['הבירוקרטיה']);
    const unknown = await sql`
      select * from open_answers('oatest', null, false, array['why'], 'segment', '__unknown__', 50, 0)`;
    expect(unknown).toHaveLength(0); // every respondent here has a known segment
  });

  it('reports all four length percentiles, interpolating between answers', async () => {
    // Lengths 2, 4, 6, 10. The median sits between the middle two: 4 + (6-4)/2 = 5.
    // p90 sits 70% of the way from 6 to 10 — 8.8, which the cast rounds to 9.
    // A switch to percentile_disc would give 4 and 10 instead, so these two
    // numbers are what pins the discipline and not merely the values.
    const rows = await sql`select * from open_answer_stats('oatest', null, false, 'why2')`;
    expect(rows[0]).toMatchObject({
      screen_id: 'why2',
      answered: 4,
      len_min: 2,
      len_median: 5,
      len_p90: 9,
      len_max: 10,
    });
  });

  it('reads whichever variable it is asked for, not one hardcoded name', () => {
    // The regression this guards: the dimension used to be fixed as 'segment',
    // so on a console-built survey (marks named mark1, mark2…) every row came
    // back unknown and the filter quietly matched everything.
    return sql`
      select * from open_answers('oatest', null, false, array['why'], 'nosuchvar', null, 50, 0)`.then(
      (rows) => {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.dim_value === null)).toBe(true);
      },
    );
  });
});

describe.runIf(dbTestsEnabled)('admin-answers endpoint (ENG-16)', () => {
  let sql: Sql;
  let token: string;

  const call = async (query: string, auth?: string) => {
    const { default: handler } = await import('../../netlify/functions/admin-answers.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(new Request(`http://localhost/.netlify/functions/admin-answers?${query}`, { headers }));
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'oatest', 'שאלון פתוחות', [{ version: V }]);
    // The bulk rows live on a screen of their own, so every assertion about
    // `why` above and below is unaffected by them
    await resetEvents(sql, [V], [...fixture, ...bulkFixture]);
    await createAdminUser('stats-admin@first-edea.com');
    token = await signIn('stats-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('requires auth and returns stats, total and a page of rows', async () => {
    expect((await call('survey=oatest&screens=why')).status).toBe(401);
    const res = await call('survey=oatest&screens=why&limit=2', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].value).toBe('הבירוקרטיה');
    expect(body.stats[0]).toMatchObject({ screen_id: 'why', answered: 3, skipped: 1, abandoned: 1 });
  });

  it('caps the page size at 100 and validates params', async () => {
    expect((await call('survey=oatest&screens=why&limit=101', token)).status).toBe(400);
    expect((await call('survey=oatest&screens=', token)).status).toBe(400);
    expect((await call('survey=no-such&screens=why', token)).status).toBe(404);
  });

  it('serves 50 rows when no page size is asked for, and offset reaches past them', async () => {
    // 51 answers exist, so a default of "all of them" and a default of 50 are
    // finally distinguishable — with a smaller fixture both look identical.
    const first = await (await call('survey=oatest&screens=bulk', token)).json();
    expect(first.total).toBe(51);
    expect(first.rows).toHaveLength(50);

    const last = await (await call('survey=oatest&screens=bulk&offset=50', token)).json();
    expect(last.rows).toHaveLength(1);
    expect(last.rows[0].value).not.toBe(first.rows[0].value);
  });

  it('still reports the real total on a page past the last one', async () => {
    // The count rides along on the rows, so an offset beyond the end returns
    // neither — and the tab would say a question with 51 answers has none.
    const body = await (await call('survey=oatest&screens=bulk&limit=10&offset=500', token)).json();
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(51);
  });

  it('passes the dimension and its value through to the query', async () => {
    const body = await (await call('survey=oatest&screens=why&dim=segment&value=B', token)).json();
    expect(body.rows.map((r: { value: string }) => r.value)).toEqual(['הבירוקרטיה']);
  });

  it('rejects a dimension name that is not a plain code, and an over-long value', async () => {
    expect((await call('survey=oatest&screens=why&dim=bad!name', token)).status).toBe(400);
    expect((await call(`survey=oatest&screens=why&value=${'x'.repeat(201)}`, token)).status).toBe(400);
    // 200 characters is the boundary, and it is allowed
    expect((await call(`survey=oatest&screens=why&value=${'x'.repeat(200)}`, token)).status).toBe(200);
  });
});
