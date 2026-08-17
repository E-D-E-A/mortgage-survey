// The version dropdown is a first-class control in the stats console, and until
// now every DB test called these functions with p_version = null. Only
// stats_overview was ever asked for one version, so a broken filter on any of the
// other five would have shown up as wrong numbers on screen and nowhere else.
//
// A survey of its own rather than a second version bolted onto an existing
// fixture: those files assert hand-counted totals over all versions, and another
// session on a shared screen id would quietly inflate them.
//
// Runs only with DB_TESTS=1 against the local stack.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, connectLocal, dbTestsEnabled, type Sql } from './harness';
import { ensureSurvey, idFactory, resetEvents, sessionEvents } from './fixtures';

const VA = '2026-08-01.1-vftest';
const VB = '2026-08-05.2-vftest';
const ids = idFactory('cd');

// One session per version, each answering the same two screens with values that
// belong unmistakably to their own version.
const fixture = [
  ...sessionEvents(ids, 1, VA, {
    steps: [
      { screen: 'q1', answer: 'alpha', vars: { segment: 'A' } },
      { screen: 'why', answer: 'טקסט גרסה א', vars: { segment: 'A' } },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'A' } },
  }),
  ...sessionEvents(ids, 2, VB, {
    steps: [
      { screen: 'q1', answer: 'beta', vars: { segment: 'B' } },
      { screen: 'why', answer: 'טקסט גרסה ב', vars: { segment: 'B' } },
    ],
    terminal: 'complete',
    terminalPayload: { vars: { segment: 'B' } },
  }),
];

describe.runIf(dbTestsEnabled)('every statistic honours the version filter', () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connectLocal();
    await applySchema(sql);
    await ensureSurvey(sql, 'vftest', 'שאלון גרסאות', [{ version: VA }, { version: VB }]);
    await resetEvents(sql, [VA, VB], fixture);
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('stats_funnel counts only the chosen version’s sessions', async () => {
    const rows = await sql`select * from stats_funnel('vftest', ${VB}, false)`;
    expect(rows.find((r) => r.screen_id === 'q1')).toMatchObject({ viewed: 1, answered: 1 });
    // Both versions together would read 2 — that is what a leaking filter looks like
    const both = await sql`select * from stats_funnel('vftest', null, false)`;
    expect(both.find((r) => r.screen_id === 'q1')!.viewed).toBe(2);
  });

  it('stats_distributions returns only the chosen version’s answers', async () => {
    const rows = await sql`select * from stats_distributions('vftest', ${VB}, false, null)`;
    expect(rows.filter((r) => r.screen_id === 'q1').map((r) => r.answer_key)).toEqual(['beta']);
  });

  it('stats_bases counts only the chosen version’s answer bases', async () => {
    const rows = await sql`select * from stats_bases('vftest', ${VA}, false, null)`;
    expect(rows.find((r) => r.screen_id === 'q1')).toMatchObject({ answered: 1 });
  });

  it('open_answer_stats measures only the chosen version’s answers', async () => {
    const rows = await sql`select * from open_answer_stats('vftest', ${VB}, false, 'why')`;
    expect(rows[0]).toMatchObject({ screen_id: 'why', answered: 1, skipped: 0 });
    expect(rows[0].len_max).toBe('טקסט גרסה ב'.length);
  });

  it('open_answers lists only the chosen version’s rows', async () => {
    const rows = await sql`
      select * from open_answers('vftest', ${VB}, false, array['why'], null, null, 50, 0)`;
    expect(rows.map((r) => r.value)).toEqual(['טקסט גרסה ב']);
    expect(Number(rows[0].total)).toBe(1);
  });
});
