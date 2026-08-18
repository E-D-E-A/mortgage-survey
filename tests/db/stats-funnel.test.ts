// ENG-14: the per-screen funnel — viewed, answered, dropped-here, and the median
// first-attempt time. The expectations were worked out by hand from the fixture.
// Runs only with DB_TESTS=1 against the local stack.
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

const V = '2026-08-01.1-fntest';
const ids = idFactory('b2');

const config = {
  version: V,
  screens: [
    { id: 'q1', type: 'single', prompt: 'שאלה 1', options: [{ id: 'a', label: 'א' }] },
    { id: 'q2', type: 'number', prompt: 'שאלה 2' },
    { id: 'q3', type: 'text', prompt: 'שאלה 3' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

// s1: answers q1 and q2 and completes · s2: answers q1, views q2 and abandons there
// s3: views q1 and abandons without answering · s4: answers q1 twice (after going
//     back), then q2, and is screened out
// s5: a test session — excluded by default
const fixture = [
  ...sessionEvents(ids, 1, V, {
    steps: [
      { screen: 'q1', answer: 'a', ms: 4000 },
      { screen: 'q2', answer: 7, ms: 6000 },
    ],
    terminal: 'complete',
  }),
  ...sessionEvents(ids, 2, V, {
    steps: [{ screen: 'q1', answer: 'a', ms: 8000 }, { screen: 'q2' }],
  }),
  ...sessionEvents(ids, 3, V, { steps: [{ screen: 'q1' }] }),
  ...sessionEvents(ids, 4, V, {
    steps: [
      { screen: 'q1', answer: 'a', ms: 10000, attempt: 1 },
      { screen: 'q1', answer: 'a', ms: 1000, attempt: 2 },
      { screen: 'q2', answer: 3, ms: 2000 },
    ],
    terminal: 'screenout',
  }),
  ...sessionEvents(ids, 5, V, {
    startVars: { url_test: '1' },
    steps: [{ screen: 'q1', answer: 'a', ms: 99999 }],
    terminal: 'complete',
  }),
];

describe.runIf(dbTestsEnabled)('stats_funnel (ENG-14)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'fntest', 'שאלון משפך', [{ version: V, config }]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('counts viewed / answered / dropped-here per screen, test sessions excluded', async () => {
    const rows = await sql`select * from stats_funnel('fntest', null, false) order by screen_id`;
    expect(rows).toHaveLength(2); // viewed screens only; end screens get no screen_view
    const [q1, q2] = rows;
    expect(q1).toMatchObject({ screen_id: 'q1', viewed: 4, answered: 3, dropped_here: 1 });
    expect(q2).toMatchObject({ screen_id: 'q2', viewed: 3, answered: 2, dropped_here: 1 });
  });

  it('median time uses first attempts only — a quick re-answer cannot drag it down', async () => {
    const rows = await sql`select * from stats_funnel('fntest', null, false) order by screen_id`;
    // q1: first attempts of 4000/8000/10000 → 8000. The second attempt (1000ms) is left out of the computation.
    expect(rows[0].median_ms).toBe(8000);
    // q2: 6000/2000 → a continuous median of 4000
    expect(rows[1].median_ms).toBe(4000);
  });

  it('includes the test session when asked', async () => {
    const rows = await sql`select * from stats_funnel('fntest', null, true) order by screen_id`;
    expect(rows[0]).toMatchObject({ screen_id: 'q1', viewed: 5, answered: 4 });
  });
});

describe.runIf(dbTestsEnabled)('admin-stats bundle carries funnel + configs (ENG-14)', () => {
  let sql: Sql;
  let token: string;

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'fntest', 'שאלון משפך', [{ version: V, config }]);
    await resetEvents(sql, [V], fixture);
    await createAdminUser('stats-admin@first-edea.com');
    token = await signIn('stats-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('returns funnel rows and each version carries its config for UI ordering/labels', async () => {
    const { default: handler } = await import('../../netlify/functions/admin-stats.mts');
    const res = await handler(
      new Request('http://localhost/.netlify/functions/admin-stats?survey=fntest', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions[0].config.screens.map((s: { id: string }) => s.id)).toEqual([
      'q1',
      'q2',
      'q3',
      'end_complete',
    ]);
    const q1 = body.funnel.find((r: { screen_id: string }) => r.screen_id === 'q1');
    expect(q1).toMatchObject({ viewed: 4, answered: 3, dropped_here: 1, median_ms: 8000 });
  });
});
