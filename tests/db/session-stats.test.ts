// ENG-13: the test-session rule itself — a session is a test session iff its
// session_start vars carry url_test, and that one rule is what every statistic
// filters through.
//
// The per-function table below is the point of this file. Three of the seven
// statistics shipped with their exclusion asserted nowhere, and the way that
// happened is that each statistic was tested in its own file, where a missing
// check looks like nothing at all. Here a statistic with no row is visible.
//
// Runs only with DB_TESTS=1 against the local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, connectLocal, dbTestsEnabled, type Sql } from './harness';
import { ensureSurvey, idFactory, resetEvents, sessionEvents } from './fixtures';

const V1 = '2026-08-01.1-tstest';
const V2 = '2026-08-01.2-tstest';
const V3 = '2026-08-01.3-tstest';
const ids = idFactory('e5');

// V1 — the toggle fixture. s2 is the only test session, so every statistic must
// read one lower without it and exactly one higher with it.
//   s1 real · s2 marked ?test=1 · s3 real, skipped the open question
const toggleFixture = [
  ...sessionEvents(ids, 1, V1, {
    steps: [
      { screen: 'q1', answer: 'a', vars: { segment: 'A' } },
      { screen: 'q_text', answer: 'תשובה ראשונה', vars: { segment: 'A' } },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 2, V1, {
    startVars: { url_test: '1' },
    steps: [
      { screen: 'q1', answer: 'a', vars: { segment: 'A' } },
      { screen: 'q_text', answer: 'תשובה שנייה', vars: { segment: 'A' } },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 3, V1, {
    steps: [
      { screen: 'q1', answer: 'b', vars: { segment: 'B' } },
      { screen: 'q_text', answer: null, vars: { segment: 'B' } },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'B' } },
  }),
];

// V2 — the predicate fixture. All three abandon, so they stay out of the quota
// count below and cannot disturb it.
//   t1 no marker · t2 marked properly · t3 carries url_test on an answer event only
const predicateFixture = [
  ...sessionEvents(ids, 4, V2, { steps: [{ screen: 'q1', answer: 'a' }] }),
  ...sessionEvents(ids, 5, V2, { startVars: { url_test: '1' }, steps: [{ screen: 'q1', answer: 'a' }] }),
  ...sessionEvents(ids, 6, V2, { steps: [{ screen: 'q1', answer: 'a', vars: { url_test: '1' } }] }),
];

// V3 — one session that reports the same variable twice with different values.
const precedenceFixture = sessionEvents(ids, 7, V3, {
  steps: [
    { screen: 'q1', answer: 'x', vars: { segment: 'A', url_source: 'panel' } },
    { screen: 'q2', answer: 'y', vars: { segment: 'B', url_source: 'panel' } },
  ],
});

describe.runIf(dbTestsEnabled)('the test-session rule reaches every statistic (ENG-13)', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'tstest', 'שאלון סשני בדיקה', [
      { version: V1 },
      { version: V2 },
      { version: V3 },
    ]);
    await resetEvents(sql, [V1, V2, V3], [...toggleFixture, ...predicateFixture, ...precedenceFixture]);
  });

  afterAll(async () => {
    await sql?.end();
  });

  // One number per statistic, hand-computed over the V1 fixture. Every entry
  // reads the same way: this is the count with the test session left out.
  const PROBES: { name: string; base: number; read: (includeTest: boolean) => Promise<number> }[] = [
    {
      name: 'stats_overview',
      base: 2,
      read: async (t) => {
        const rows = await sql`select * from stats_overview('tstest', ${V1}, ${t})`;
        return rows[0].total_sessions;
      },
    },
    {
      name: 'stats_funnel',
      base: 2,
      read: async (t) => {
        const rows = await sql`select * from stats_funnel('tstest', ${V1}, ${t})`;
        return rows.find((r) => r.screen_id === 'q1')!.viewed;
      },
    },
    {
      name: 'stats_distributions',
      base: 1,
      read: async (t) => {
        const rows = await sql`select * from stats_distributions('tstest', ${V1}, ${t}, null)`;
        return rows.find((r) => r.screen_id === 'q1' && r.answer_key === 'a')?.n ?? 0;
      },
    },
    {
      name: 'stats_bases',
      base: 2,
      read: async (t) => {
        const rows = await sql`select * from stats_bases('tstest', ${V1}, ${t}, null)`;
        return rows.find((r) => r.screen_id === 'q1')!.answered;
      },
    },
    {
      name: 'open_answer_stats',
      base: 1,
      read: async (t) => {
        const rows = await sql`select * from open_answer_stats('tstest', ${V1}, ${t}, 'q_text')`;
        return rows[0].answered;
      },
    },
    {
      name: 'open_answers',
      base: 1,
      read: async (t) => {
        const rows = await sql`
          select * from open_answers('tstest', ${V1}, ${t}, array['q_text'], null, null, 50, 0)`;
        return rows.length === 0 ? 0 : Number(rows[0].total);
      },
    },
  ];

  it.each(PROBES.map((p) => [p.name, p] as const))(
    '%s leaves the test session out by default',
    async (_name, probe) => {
      expect(await probe.read(false)).toBe(probe.base);
    },
  );

  it.each(PROBES.map((p) => [p.name, p] as const))(
    '%s adds back exactly the one test session when asked for it',
    async (_name, probe) => {
      expect(await probe.read(true)).toBe(probe.base + 1);
    },
  );

  it('quota_counts never counts a test session — it has no toggle, and must not have one', () => {
    // Our own ?test=1 clicks closing the real study's quotas is the failure this
    // prevents, and it is invisible from the outside: the survey simply starts
    // turning respondents away. s2 holds the same persona value as s1, so a
    // count of 2 here would mean the exclusion had stopped working.
    return sql`select * from quota_counts('tstest', array['segment'])`.then((rows) => {
      const bySegment = Object.fromEntries(rows.map((r) => [r.value, r.n]));
      expect(bySegment).toEqual({ A: 1, B: 1 });
    });
  });

  it('a session is a test session only when url_test is on session_start itself', () => {
    // t3 is the one that matters: it carries url_test inside an answer event's
    // vars. Loosening the predicate to any event would quietly start discarding
    // real respondents from every statistic at once.
    return sql`
      select session_id, is_test from session_stats
      where session_id in (${ids.sid(4)}, ${ids.sid(5)}, ${ids.sid(6)})
      order by session_id`.then((rows) => {
      const flags = Object.fromEntries(rows.map((r) => [r.session_id, r.is_test]));
      expect(flags[ids.sid(4)]).toBe(false);
      expect(flags[ids.sid(5)]).toBe(true);
      expect(flags[ids.sid(6)]).toBe(false);
    });
  });

  it('effective vars come from the last snapshot, not the first — a later value wins', () => {
    // Both events carry the whole vars object, so "latest wins" and "merge the
    // keys" agree on everything except a key that changed. segment is that key.
    return sql`select vars from session_stats where session_id = ${ids.sid(7)}`.then((rows) => {
      expect(rows[0].vars).toEqual({ segment: 'B', url_source: 'panel' });
    });
  });
});
