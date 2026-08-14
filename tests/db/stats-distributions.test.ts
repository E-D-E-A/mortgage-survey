// ENG-15: one final answer per session per question (final_answers) and the
// expansion into answer atoms for the distributions (stats_distributions). The
// expectations were worked out by hand. Runs only with DB_TESTS=1.
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

const V = '2026-08-01.1-dstest';
const ids = idFactory('c3');

// s1: single=a · multi=[x,y] · matrix {i1:4, i2:na} · number=7
// s2: single answered a, went back and changed it to b (attempt 2) · multi=[x] ·
//     matrix {i1:5, i2:2} · number=7
// s3: single=a only, then abandoned
// s4: number=12, a skipped text answer (value null) — null is not an atom
// s5: a test session, single=a — excluded by default
const fixture = [
  ...sessionEvents(ids, 1, V, {
    steps: [
      { screen: 'q_single', answer: 'a' },
      { screen: 'q_multi', answer: ['x', 'y'] },
      { screen: 'q_matrix', answer: { i1: 4, i2: 'na' } },
      { screen: 'q_num', answer: 7 },
    ],
    terminal: 'complete',
  }),
  ...sessionEvents(ids, 2, V, {
    steps: [
      { screen: 'q_single', answer: 'a', attempt: 1 },
      { screen: 'q_single', answer: 'b', attempt: 2 },
      { screen: 'q_multi', answer: ['x'] },
      { screen: 'q_matrix', answer: { i1: 5, i2: 2 } },
      { screen: 'q_num', answer: 7 },
    ],
    terminal: 'complete',
  }),
  ...sessionEvents(ids, 3, V, { steps: [{ screen: 'q_single', answer: 'a' }] }),
  ...sessionEvents(ids, 4, V, {
    steps: [
      { screen: 'q_num', answer: 12 },
      { screen: 'q_text', answer: null },
    ],
    terminal: 'complete',
  }),
  ...sessionEvents(ids, 5, V, {
    startVars: { url_test: '1' },
    steps: [{ screen: 'q_single', answer: 'a' }],
    terminal: 'complete',
  }),
];

describe.runIf(dbTestsEnabled)('final_answers + stats_distributions (ENG-15)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'dstest', 'שאלון התפלגויות', [{ version: V }]);
    await resetEvents(sql, [V], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  const dist = async (includeTest = false) =>
    sql`select * from stats_distributions('dstest', null, ${includeTest})
        order by screen_id, item_id nulls first, answer_key`;

  it('a back-and-change session counts exactly once, with its final answer', async () => {
    const rows = await dist();
    const single = rows.filter((r) => r.screen_id === 'q_single');
    // a: s1 + s3 (s2's first attempt was overwritten by attempt 2) · b: s2
    expect(single).toEqual([
      expect.objectContaining({ answer_key: 'a', item_id: null, n: 2 }),
      expect.objectContaining({ answer_key: 'b', item_id: null, n: 1 }),
    ]);
  });

  it('multi-choice explodes to one atom per selected option', async () => {
    const rows = await dist();
    const multi = rows.filter((r) => r.screen_id === 'q_multi');
    expect(multi).toEqual([
      expect.objectContaining({ answer_key: 'x', n: 2 }),
      expect.objectContaining({ answer_key: 'y', n: 1 }),
    ]);
  });

  it('matrix explodes per item, keeping na as its own key; numbers keep their text form', async () => {
    const rows = await dist();
    const matrix = rows.filter((r) => r.screen_id === 'q_matrix');
    expect(matrix).toEqual([
      expect.objectContaining({ item_id: 'i1', answer_key: '4', n: 1 }),
      expect.objectContaining({ item_id: 'i1', answer_key: '5', n: 1 }),
      expect.objectContaining({ item_id: 'i2', answer_key: '2', n: 1 }),
      expect.objectContaining({ item_id: 'i2', answer_key: 'na', n: 1 }),
    ]);
    const num = rows.filter((r) => r.screen_id === 'q_num');
    expect(num).toEqual([
      expect.objectContaining({ answer_key: '12', n: 1 }),
      expect.objectContaining({ answer_key: '7', n: 2 }),
    ]);
  });

  it('a deliberately skipped text answer (null) is not an atom, and test sessions stay out', async () => {
    const rows = await dist();
    expect(rows.some((r) => r.screen_id === 'q_text')).toBe(false);
    const withTest = await dist(true);
    const a = withTest.find((r) => r.screen_id === 'q_single' && r.answer_key === 'a');
    expect(a?.n).toBe(3);
  });
});

describe.runIf(dbTestsEnabled)('admin-stats bundle carries distributions (ENG-15)', () => {
  let sql: Sql;
  let token: string;

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'dstest', 'שאלון התפלגויות', [{ version: V }]);
    await resetEvents(sql, [V], fixture);
    await createAdminUser('stats-admin@first-edea.com');
    token = await signIn('stats-admin@first-edea.com');
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('returns the distribution rows alongside overview and funnel', async () => {
    const { default: handler } = await import('../../netlify/functions/admin-stats.mts');
    const res = await handler(
      new Request('http://localhost/.netlify/functions/admin-stats?survey=dstest', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const single = body.distributions.filter(
      (r: { screen_id: string }) => r.screen_id === 'q_single',
    );
    expect(single).toHaveLength(2);
    expect(body.overview.total_sessions).toBe(4);
    expect(body.funnel.length).toBeGreaterThan(0);
  });
});
