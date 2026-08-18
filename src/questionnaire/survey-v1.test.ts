// Routing tests for the questionnaire: the three segment paths, every screenout,
// and the 15-question budget — driven through the real engine rather than
// asserted on the config shape, so a wrong showIf or a stale `segment` var fails here.

import { describe, expect, it } from 'vitest';
import { evaluate } from '../engine/conditions';
import { findNext } from '../engine/navigation';
import { validateConfig } from '../engine/validate';
import type { AnswerValue, Screen, SurveyContext } from '../engine/types';
import { questionnaire as config } from './survey-v1';

/** A screen that counts as a "question" against the budget — info, consent and end screens do not. */
const isQuestion = (s: Screen) => s.type !== 'info' && s.type !== 'end' && s.type !== 'consent';

/**
 * Runs the survey from the first screen, answering per `answers` (screen id →
 * answer), and returns the sequence of screens the respondent actually saw. A
 * screen with no answer defined gets null (like skipping a question) — so a path
 * is exercised even when not every question was answered.
 */
function walk(answers: Record<string, AnswerValue>): {
  path: string[];
  questions: number;
  ctx: SurveyContext;
} {
  const ctx: SurveyContext = { answers: {}, vars: {} };
  let screen: Screen | null = config.screens[0];
  const path: string[] = [];
  let questions = 0;

  while (screen && path.length < 200) {
    path.push(screen.id);
    if (isQuestion(screen)) questions++;
    if (screen.type === 'end') break;

    if (screen.id in answers) ctx.answers[screen.id] = answers[screen.id];
    for (const rule of screen.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) ctx.vars[rule.var] = rule.value;
    }
    screen = findNext(config, screen, ctx);
  }

  expect(path.length).toBeLessThan(200); // guard against a routing loop
  return { path, questions, ctx };
}

const CONSENTED = { consent: 'agreed', s_age: 35 };

const PATHS: Record<'A' | 'B' | 'C', Record<string, AnswerValue>> = {
  A: { ...CONSENTED, s_status: 'active' },
  B: { ...CONSENTED, s_status: 'none', s_timeline: 'm4_6', s_actions: ['bank'] },
  C: { ...CONSENTED, s_status: 'none', s_timeline: 'later', s_actions: ['none'] },
};

describe('config integrity', () => {
  it('passes static validation with no errors', () => {
    expect(validateConfig(config).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('has no validation warnings either', () => {
    expect(validateConfig(config)).toEqual([]);
  });

  it('every screen id is unique', () => {
    const ids = config.screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The console reads names, not codes: every variable the survey assigns has to
  // have a Hebrew label, and every value it takes has to have a name. Without that
  // the admin sees "segment: A" on the diagram's edges and in the editor — exactly
  // the fog that already happened once, when varMeta was deleted by accident.
  it('every mark the survey sets has a Hebrew display name for it and its values', () => {
    for (const screen of config.screens) {
      for (const rule of screen.onSubmit ?? []) {
        const meta = config.varMeta?.[rule.var];
        expect(meta?.label, `var "${rule.var}" (set in ${screen.id}) needs a label`).toBeTruthy();
        expect(
          meta?.values?.[String(rule.value)],
          `value "${rule.value}" of "${rule.var}" (set in ${screen.id}) needs a label`,
        ).toBeTruthy();
      }
    }
  });
});

describe('the 15-question budget', () => {
  it.each(['A', 'B', 'C'] as const)('segment %s asks exactly 15 questions', (seg) => {
    expect(walk(PATHS[seg]).questions).toBe(15);
  });

  it('holds on every reachable path, not just the sampled ones', () => {
    // There is no branching within the tracks in the lean version — every answer to
    // a routing question leads to the same number of questions. This test walks
    // every possible routing combination.
    const statuses = ['active', 'past5', 'none', 'dontknow'];
    const timelines = ['m0_3', 'm4_6', 'm7_12', 'm13_24', 'later', 'unknown', 'never'];
    const actions = [['budget'], ['bank'], ['search'], ['docs'], ['none']];

    for (const s_status of statuses) {
      for (const s_timeline of timelines) {
        for (const s_actions of actions) {
          const { questions, path, ctx } = walk({ ...CONSENTED, s_status, s_timeline, s_actions });
          if (path.at(-1) !== 'end_complete') continue;
          expect(questions, `segment ${ctx.vars.segment} exceeded the budget`).toBe(15);
        }
      }
    }
  });

  it('splits the budget as designed: A trades two screening slots for two track questions', () => {
    const count = (prefix: string) =>
      config.screens.filter((s) => s.id.startsWith(prefix) && isQuestion(s)).length;
    expect(count('a_')).toBe(9);
    expect(count('b_')).toBe(7);
    expect(count('c_')).toBe(7);
    expect(count('d_')).toBe(3);
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
    expect(path).not.toContain('s_status');
  });

  it('not involved in household mortgage decisions is screened out', () => {
    const { path } = walk({ ...CONSENTED, s_status: 'not_involved' });
    expect(path.at(-1)).toBe('end_screenout');
    expect(path).not.toContain('s_timeline');
    expect(path).not.toContain('d_household');
  });
});

describe('segment A — has or had a mortgage', () => {
  it('routes to A and skips the B/C screening questions', () => {
    const { path, ctx } = walk(PATHS.A);
    expect(ctx.vars.segment).toBe('A');
    expect(path).not.toContain('s_timeline');
    expect(path).not.toContain('s_actions');
    expect(path.at(-1)).toBe('end_complete');
  });

  it('past-5-years experience also routes to A', () => {
    expect(walk({ ...PATHS.A, s_status: 'past5' }).ctx.vars.segment).toBe('A');
  });

  it('asks the full A track and nothing from B or C', () => {
    const { path } = walk(PATHS.A);
    for (const id of [
      'a_last_when',
      'a_difficulty',
      'a_refi',
      'a_cashflow',
      'a_priority',
      'a_advisor',
      'a_deal_type',
      'a_easier',
      'a_commit',
    ]) {
      expect(path, `A should ask ${id}`).toContain(id);
    }
    expect(path.filter((id) => id.startsWith('b_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('c_'))).toEqual([]);
  });

  it('shows the unbiased need question before the product concept', () => {
    const { path } = walk(PATHS.A);
    expect(path.indexOf('a_easier')).toBeLessThan(path.indexOf('a_concept'));
  });
});

describe('segment B — timeline within 12 months plus a real action', () => {
  it('routes to B and asks the full B track', () => {
    const { path, ctx } = walk(PATHS.B);
    expect(ctx.vars.segment).toBe('B');
    for (const id of [
      'b_deal_type',
      'b_ceiling',
      'b_unclear',
      'b_sure',
      'b_delay',
      'b_confident',
      'b_commit',
    ]) {
      expect(path, `B should ask ${id}`).toContain(id);
    }
    expect(path.filter((id) => id.startsWith('a_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('c_'))).toEqual([]);
    expect(path.at(-1)).toBe('end_complete');
  });

  it('counts every action the skeleton lists as real, not just bank contact', () => {
    for (const action of ['budget', 'bank', 'advisor', 'approval', 'search', 'legal', 'docs']) {
      const { ctx } = walk({ ...PATHS.B, s_actions: [action] });
      expect(ctx.vars.segment, `action "${action}" should route to B`).toBe('B');
    }
  });

  it('shows the unbiased need question before the product concept', () => {
    const { path } = walk(PATHS.B);
    expect(path.indexOf('b_confident')).toBeLessThan(path.indexOf('b_concept'));
  });
});

describe('segment C — everything else', () => {
  it('routes to C and asks the full C track', () => {
    const { path, ctx } = walk(PATHS.C);
    expect(ctx.vars.segment).toBe('C');
    for (const id of [
      'c_housing',
      'c_financial_goal',
      'c_reason',
      'c_conditions',
      'c_barriers',
      'c_small_action',
      'c_commit',
    ]) {
      expect(path, `C should ask ${id}`).toContain(id);
    }
    expect(path.filter((id) => id.startsWith('a_'))).toEqual([]);
    expect(path.filter((id) => id.startsWith('b_'))).toEqual([]);
    expect(path.at(-1)).toBe('end_complete');
  });

  it('routes to C on a near timeline with no real action', () => {
    expect(walk({ ...PATHS.C, s_timeline: 'm0_3', s_actions: ['none'] }).ctx.vars.segment).toBe('C');
  });

  it('routes to C on a real action with a distant timeline', () => {
    expect(walk({ ...PATHS.C, s_timeline: 'm13_24', s_actions: ['budget'] }).ctx.vars.segment).toBe(
      'C',
    );
  });

  it("routes 'don't know' timelines to C", () => {
    expect(walk({ ...PATHS.C, s_timeline: 'unknown', s_actions: ['budget'] }).ctx.vars.segment).toBe(
      'C',
    );
  });

  it('shows the unbiased need question before the product concept', () => {
    const { path } = walk(PATHS.C);
    expect(path.indexOf('c_small_action')).toBeLessThan(path.indexOf('c_concept'));
  });
});

describe('shared blocks', () => {
  it.each(['A', 'B', 'C'] as const)('segment %s reaches demographics and the end', (seg) => {
    const { path } = walk(PATHS[seg]);
    for (const id of ['d_household', 'd_employment', 'd_income', 'end_followup']) {
      expect(path, `segment ${seg} should see ${id}`).toContain(id);
    }
    expect(path.at(-1)).toBe('end_complete');
  });

  it('age is asked once, in screening only', () => {
    const asksAge = config.screens.filter((s) => 'prompt' in s && s.prompt === 'מה גילך?');
    expect(asksAge.map((s) => s.id)).toEqual(['s_age']);
  });
});
