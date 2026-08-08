// Routing tests for the v1 questionnaire: each of the three segment paths plus
// every screenout, driven through the real engine rather than asserted on the
// config shape — so a wrong showIf or a stale `segment` var fails here.

import { describe, expect, it } from 'vitest';
import { evaluate } from '../engine/conditions';
import { findNext } from '../engine/navigation';
import { validateConfig } from '../engine/validate';
import type { AnswerValue, Screen, SurveyContext } from '../engine/types';
import { questionnaire as config } from './survey-v1';

/**
 * מריץ את השאלון מהמסך הראשון, עונה לפי `answers` (מזהה מסך → תשובה),
 * ומחזיר את רצף המסכים שהמשיב ראה בפועל. מסך ללא תשובה מוגדרת מקבל null
 * (כמו דילוג על שאלה) — כך שמסלול נבדק גם כשלא כל שאלה נענתה.
 */
function walk(answers: Record<string, AnswerValue>): { path: string[]; ctx: SurveyContext } {
  const ctx: SurveyContext = { answers: {}, vars: {} };
  let screen: Screen | null = config.screens[0];
  const path: string[] = [];

  while (screen && path.length < 200) {
    path.push(screen.id);
    if (screen.type === 'end') break;

    if (screen.id in answers) ctx.answers[screen.id] = answers[screen.id];
    for (const rule of screen.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) ctx.vars[rule.var] = rule.value;
    }
    screen = findNext(config, screen, ctx);
  }

  expect(path.length).toBeLessThan(200); // guard against a routing loop
  return { path, ctx };
}

const CONSENTED = { consent: 'agreed', s_age: 35, s_role: 'main' };

describe('survey-v1 config', () => {
  it('passes static validation with no errors', () => {
    const issues = validateConfig(config);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('has no validation warnings either', () => {
    expect(validateConfig(config)).toEqual([]);
  });

  it('every screen id is unique', () => {
    const ids = config.screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('screenouts', () => {
  it('declining consent ends the session', () => {
    const { path } = walk({ consent: 'declined' });
    expect(path.at(-1)).toBe('end_screenout');
    expect(path).not.toContain('s_age');
  });

  it('under 18 is screened out', () => {
    const { path } = walk({ consent: 'agreed', s_age: 17 });
    expect(path.at(-1)).toBe('end_screenout');
    expect(path).not.toContain('s_role');
  });

  it('not involved in the decision is screened out', () => {
    const { path } = walk({ consent: 'agreed', s_age: 40, s_role: 'none' });
    expect(path.at(-1)).toBe('end_screenout');
    expect(path).not.toContain('s_status');
  });
});

describe('segment A — has or had a mortgage', () => {
  const answers = {
    ...CONSENTED,
    s_status: 'active',
    a_last_when: 'm1_3',
    a_refi: 'considered_not',
    a_advisor: 'private',
    a_deal_soon: 'no',
  };

  it('routes to A and skips the B/C screening questions', () => {
    const { path, ctx } = walk(answers);
    expect(ctx.vars.segment).toBe('A');
    expect(path).not.toContain('s_timeline');
    expect(path).not.toContain('s_actions');
    expect(path).toContain('a_last_when');
    expect(path).toContain('a_difficulty');
    expect(path.at(-1)).toBe('end_complete');
  });

  it('past-5-years experience also routes to A', () => {
    const { ctx } = walk({ ...answers, s_status: 'past5' });
    expect(ctx.vars.segment).toBe('A');
  });

  it('shows no B or C screens', () => {
    const { path } = walk(answers);
    expect(path.filter((id) => id.startsWith('b_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('c_'))).toEqual([]);
  });

  it('asks why-no-advisor only when no advisor was used', () => {
    expect(walk(answers).path).toContain('a_advisor_checks');
    expect(walk(answers).path).not.toContain('a_no_advisor');

    const none = walk({ ...answers, a_advisor: 'no' }).path;
    expect(none).toContain('a_no_advisor');
    expect(none).not.toContain('a_advisor_checks');
  });

  it('asks the refinance follow-ups only when refinancing was considered', () => {
    const considered = walk(answers).path;
    expect(considered).toContain('a_refi_trigger');
    expect(considered).toContain('a_refi_blocker');

    const done = walk({ ...answers, a_refi: 'considered_done' }).path;
    expect(done).toContain('a_refi_trigger');
    expect(done).not.toContain('a_refi_blocker'); // כבר ביצע — "מה עצר אותך" לא רלוונטית

    const never = walk({ ...answers, a_refi: 'no' }).path;
    expect(never).not.toContain('a_refi_trigger');
    expect(never).not.toContain('a_refi_blocker');
  });

  it('skips the event follow-ups when nothing was ever done', () => {
    const { path } = walk({ ...answers, a_last_when: 'never' });
    expect(path).not.toContain('a_last_why');
    expect(path).not.toContain('a_actions');
    expect(path).not.toContain('a_paid');
    expect(path).toContain('a_difficulty'); // הבלוק ממשיך כרגיל
  });

  it('shows the bridge deal-type screen only when a new deal is expected', () => {
    expect(walk(answers).path).not.toContain('a_deal_type');
    expect(walk({ ...answers, a_deal_soon: 'yes' }).path).toContain('a_deal_type');
    expect(walk({ ...answers, a_deal_soon: 'maybe' }).path).toContain('a_deal_type');
  });
});

describe('segment B — timeline within 12 months plus a real action', () => {
  const answers = {
    ...CONSENTED,
    s_status: 'none',
    s_timeline: 'm4_6',
    s_actions: ['bank'],
    b_deal_type: 'first',
  };

  it('routes to B and shows the B track', () => {
    const { path, ctx } = walk(answers);
    expect(ctx.vars.segment).toBe('B');
    expect(path).toContain('s_timeline');
    expect(path).toContain('b_deal_type');
    expect(path).toContain('b_sure');
    expect(path).toContain('b_price');
    expect(path.at(-1)).toBe('end_complete');
  });

  it('shows no A or C screens', () => {
    const { path } = walk(answers);
    expect(path.filter((id) => id.startsWith('a_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('c_'))).toEqual([]);
  });

  it('counts every action the skeleton lists as real, not just bank contact', () => {
    for (const action of ['budget', 'bank', 'advisor', 'approval', 'search', 'legal', 'docs']) {
      const { ctx } = walk({ ...answers, s_actions: [action] });
      expect(ctx.vars.segment, `action "${action}" should route to B`).toBe('B');
    }
  });
});

describe('segment C — everything else', () => {
  const answers = {
    ...CONSENTED,
    s_status: 'none',
    s_timeline: 'later',
    s_actions: ['none'],
  };

  it('routes to C when the timeline is distant', () => {
    const { path, ctx } = walk(answers);
    expect(ctx.vars.segment).toBe('C');
    expect(path).toContain('c_housing');
    expect(path).toContain('c_literacy');
    expect(path.at(-1)).toBe('end_complete');
  });

  it('routes to C on a near timeline with no real action', () => {
    const { ctx } = walk({ ...answers, s_timeline: 'm0_3', s_actions: ['none'] });
    expect(ctx.vars.segment).toBe('C');
  });

  it('routes to C on a real action with a distant timeline', () => {
    const { ctx } = walk({ ...answers, s_timeline: 'm13_24', s_actions: ['budget'] });
    expect(ctx.vars.segment).toBe('C');
  });

  it("routes 'don't know' timelines to C", () => {
    const { ctx } = walk({ ...answers, s_timeline: 'unknown', s_actions: ['budget'] });
    expect(ctx.vars.segment).toBe('C');
  });

  it('shows no A or B screens', () => {
    const { path } = walk(answers);
    expect(path.filter((id) => id.startsWith('a_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('b_'))).toEqual([]);
  });
});

describe('shared blocks', () => {
  const paths = {
    A: walk({ ...CONSENTED, s_status: 'active', a_last_when: 'never', a_deal_soon: 'no' }).path,
    B: walk({ ...CONSENTED, s_status: 'none', s_timeline: 'm0_3', s_actions: ['budget'] }).path,
    C: walk({ ...CONSENTED, s_status: 'none', s_timeline: 'never', s_actions: ['none'] }).path,
  };

  it.each(['A', 'B', 'C'] as const)('segment %s reaches demographics and the end', (seg) => {
    for (const id of ['d_gender', 'd_employment', 'd_income', 'd_assets', 'end_followup']) {
      expect(paths[seg], `segment ${seg} should see ${id}`).toContain(id);
    }
    expect(paths[seg].at(-1)).toBe('end_complete');
  });

  it('age is asked once, in screening only', () => {
    const asksAge = config.screens.filter((s) => 'prompt' in s && s.prompt === 'מה גילך?');
    expect(asksAge.map((s) => s.id)).toEqual(['s_age']);
  });
});

describe('scope targets from the triage', () => {
  const isQuestion = (s: Screen) => s.type !== 'info' && s.type !== 'end' && s.type !== 'consent';
  const count = (prefix: string) =>
    config.screens.filter((s) => s.id.startsWith(prefix) && isQuestion(s)).length;

  it('matches the approved per-track budgets', () => {
    expect(count('s_')).toBe(5); // age · role · status · timeline · actions
    expect(count('a_')).toBe(19);
    expect(count('b_')).toBe(19);
    expect(count('c_')).toBe(12);
    expect(count('d_')).toBe(7);
  });
});
