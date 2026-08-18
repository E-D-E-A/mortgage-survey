import { describe, expect, it } from 'vitest';
import { evaluate } from './conditions';
import { findNext } from './navigation';
import { progressRatio, pruneAnswers, simulatePath, visitedPath } from './path';
import { quotaFullVar } from './quota';
import type { AnswerValue, Answers, Screen, SurveyConfig, SurveyContext, Vars } from './types';
import { questionnaire } from '../questionnaire/survey-v1';
import { buildFlow } from '../admin/graph';

/**
 * Simulates a real respondent: answers, fires onSubmit, moves on to findNext —
 * exactly the order App.submit uses. `route` fixes the answers that route; every
 * other screen gets some valid answer.
 */
function run(config: SurveyConfig, route: Record<string, AnswerValue>) {
  const answers: Answers = {};
  const vars: Vars = {};
  const ctx: SurveyContext = { answers, vars };
  const steps: { id: string; progress: number }[] = [];
  const guard = new Set<string>();

  let current: Screen | null = config.screens[0];
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    steps.push({ id: current.id, progress: progressRatio(config, current.id, ctx) });
    if (current.type === 'end') break;
    const value = current.id in route ? route[current.id] : defaultAnswer(current);
    if (value !== undefined) answers[current.id] = value;
    for (const rule of current.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) vars[rule.var] = rule.value;
    }
    current = findNext(config, current, ctx);
  }
  return { steps, answers, vars, ctx };
}

function defaultAnswer(screen: Screen): AnswerValue | undefined {
  switch (screen.type) {
    case 'consent':
      return 'agreed';
    case 'single':
      return screen.options[0].id;
    case 'multi':
      return [screen.options[0].id];
    case 'matrix':
      return Object.fromEntries(screen.items.map((it) => [it.id, screen.scaleMin]));
    case 'number':
      return screen.min ?? 1;
    case 'text':
      return 'תשובה';
    default:
      return undefined;
  }
}

/** Screening answers that pass: age 40 (16 would trigger the under-18 screenout). */
const PASSES_SCREENING: Record<string, AnswerValue> = { s_age: 40 };

/** Segment A: has a mortgage. */
const ROUTE_A: Record<string, AnswerValue> = { ...PASSES_SCREENING, s_status: 'active' };

/** Segment B: no mortgage, a near-term expectation and a real action taken. */
const ROUTE_B: Record<string, AnswerValue> = {
  ...PASSES_SCREENING,
  s_status: 'none',
  s_timeline: 'm0_3',
  s_actions: ['bank'],
};

/** The same route, after the respondent went back to s_actions and picked "I did none" — segment C. */
const ROUTE_C: Record<string, AnswerValue> = { ...ROUTE_B, s_actions: ['none'] };

const ALL_ROUTES = [ROUTE_A, ROUTE_B, ROUTE_C];

describe('visitedPath', () => {
  it('walks the real questionnaire end to end for each segment', () => {
    for (const route of ALL_ROUTES) {
      const { steps } = run(questionnaire, route);
      expect(steps[steps.length - 1].id).toBe('end_complete');
    }
  });

  it('stops at a screenout without walking the rest of the survey', () => {
    const { steps } = run(questionnaire, { ...PASSES_SCREENING, s_status: 'not_involved' });
    expect(steps[steps.length - 1].id).toBe('end_screenout');
    expect(steps.map((s) => s.id)).not.toContain('d_household');
  });

  it('terminates on a config that contains a routing cycle', () => {
    const loop: SurveyConfig = {
      version: 't',
      screens: [
        { id: 'a', type: 'info', title: 'A', body: '', next: [{ goto: 'b' }] },
        { id: 'b', type: 'info', title: 'B', body: '', next: [{ goto: 'a' }] },
      ],
    };
    expect(visitedPath(loop, { answers: {}, vars: {} }).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('pruneAnswers', () => {
  it('drops answers from a segment the respondent left (QA S2)', () => {
    // The respondent answered b_deal_type on route B, then went back and changed s_actions to C
    const { answers, vars } = run(questionnaire, ROUTE_C);
    const stale = { ...answers, b_deal_type: 'first', b_stage: 'budget' };

    const pruned = pruneAnswers(questionnaire, { answers: stale, vars });

    expect(pruned).not.toHaveProperty('b_deal_type');
    expect(pruned).not.toHaveProperty('b_stage');
    // and nothing from the path the respondent actually walked went missing
    expect(Object.keys(pruned).sort()).toEqual(Object.keys(answers).sort());
  });

  it('drops leftover segment A answers after a move to B (QA S2)', () => {
    const { answers, vars } = run(questionnaire, ROUTE_B);
    const stale = { ...answers, a_last_when: 'm1_3', a_last_why: 'סיבה' };

    const pruned = pruneAnswers(questionnaire, { answers: stale, vars });

    expect(pruned).not.toHaveProperty('a_last_when');
    expect(pruned).not.toHaveProperty('a_last_why');
    expect(pruned.b_deal_type).toBe(answers.b_deal_type);
  });

  it('is a no-op on a clean run', () => {
    const { answers, vars } = run(questionnaire, ROUTE_A);
    expect(pruneAnswers(questionnaire, { answers, vars })).toEqual(answers);
  });

  it('keeps the answer that caused the reroute', () => {
    const { answers, vars } = run(questionnaire, ROUTE_C);
    const pruned = pruneAnswers(questionnaire, { answers, vars });
    expect(pruned.s_actions).toEqual(['none']);
    expect(pruned.s_status).toBe('none');
  });
});

describe('progressRatio', () => {
  /** What the respondent actually sees: the running maximum (App.tsx never lets the bar retreat). */
  function shownPercents(route: Record<string, AnswerValue>): number[] {
    let max = 0;
    return run(questionnaire, route).steps.map((s) => {
      max = Math.max(max, s.progress);
      return Math.round(max * 100);
    });
  }

  it('never jumps the way the full-array count did (QA S7: 38% → 87%)', () => {
    for (const route of ALL_ROUTES) {
      const percents = shownPercents(route);
      const jumps = percents.slice(1).map((p, i) => p - percents[i]);
      expect(Math.max(...jumps)).toBeLessThanOrEqual(15);
    }
  });

  it('never moves backwards and ends at 100%', () => {
    for (const route of ALL_ROUTES) {
      const percents = shownPercents(route);
      expect(percents).toEqual([...percents].sort((a, b) => a - b));
      expect(percents[0]).toBe(0);
      expect(percents[percents.length - 1]).toBe(100);
    }
  });

  it('reflects the segment path length, not the 70-screen array', () => {
    // At a_commit 8 screens out of 32 are left — the bar has to be high, not 38%
    const { steps } = run(questionnaire, ROUTE_A);
    const atCommit = steps.find((s) => s.id === 'a_commit')!;
    expect(Math.round(atCommit.progress * 100)).toBeGreaterThan(70);
  });

  it('returns 0 for a screen that is not on the path', () => {
    expect(progressRatio(questionnaire, 'b_deal_type', { answers: {}, vars: { segment: 'A' } })).toBe(0);
  });
});

describe('simulatePath', () => {
  // The console's simulator promises the admin "this is exactly what will
  // happen". This test is that promise: the same path and the same variables as
  // a full run of the engine.
  it.each([
    ['A', ROUTE_A],
    ['B', ROUTE_B],
    ['C', ROUTE_C],
  ])('reproduces the engine walk for segment %s from answers alone', (_name, route) => {
    const { steps, answers, vars } = run(questionnaire, route);

    const simulated = simulatePath(questionnaire, answers);

    expect(simulated.map((s) => s.screen.id)).toEqual(steps.map((s) => s.id));
    expect(simulated[simulated.length - 1].vars).toEqual(vars);
  });

  it('computes segment on the way instead of receiving it', () => {
    const { answers } = run(questionnaire, ROUTE_B);
    const atActions = simulatePath(questionnaire, answers).find((s) => s.screen.id === 's_actions');
    expect(atActions?.vars.segment).toBe('B');
  });

  it('terminates on a config that contains a routing cycle', () => {
    const loop: SurveyConfig = {
      version: 't',
      screens: [
        { id: 'a', type: 'info', title: 'A', body: '', next: [{ goto: 'b' }] },
        { id: 'b', type: 'info', title: 'B', body: '', next: [{ goto: 'a' }] },
      ],
    };
    expect(simulatePath(loop, {}).map((s) => s.screen.id)).toEqual(['a', 'b']);
  });

  it('a drawn value is the same on every step of the walk', () => {
    // What "drawn once per session" looks like from the respondent's side: the
    // price in the question never changes under them, and the condition that
    // reads it decides the same way from the first screen to the last.
    const cfg: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      screens: [
        { id: 'a', type: 'info', title: 'מחיר: {price}', body: '' },
        { id: 'b', type: 'info', title: 'יקר', body: '', showIf: { var: 'price', op: 'gt', value: 100 } },
        { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
      ],
    };
    const steps = simulatePath(cfg, {}, { price: 149 });
    expect(steps.map((s) => s.screen.id)).toEqual(['a', 'b', 'end']);
    expect(steps.every((s) => s.vars.price === 149)).toBe(true);
  });

  // The console's path check feeds quota state in through the seed — this is the
  // one path an admin cannot test on the live survey without waiting for a quota
  // to genuinely fill
  it('honours quota flags handed in as seed vars', () => {
    const cfg: SurveyConfig = {
      version: 't',
      varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 50 } } },
      screens: [
        {
          id: 'q1',
          type: 'info',
          title: 'A',
          body: '',
          onSubmit: [{ var: 'persona', value: 'young_couple' }],
        },
        { id: 'q2', type: 'info', title: 'B', body: '' },
        { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
        { id: 'full', type: 'end', variant: 'quotafull', title: '', body: '' },
      ],
    };
    expect(simulatePath(cfg, {}).map((s) => s.screen.id)).toEqual(['q1', 'q2', 'end']);
    expect(
      simulatePath(cfg, {}, { [quotaFullVar('persona', 'young_couple')]: true }).map((s) => s.screen.id),
    ).toEqual(['q1', 'full']);
  });
});

describe('the flow graph never lies by omission', () => {
  // The diagram prunes transitions that cannot happen, to stay readable. The
  // dangerous way for that pruning to fail is not clutter but concealment: a
  // real transition with no edge. This is the test that blocks it.
  const ROUTES: [string, Record<string, AnswerValue>][] = [
    ['A', ROUTE_A],
    ['B', ROUTE_B],
    ['C', ROUTE_C],
    ['screenout by age', { ...PASSES_SCREENING, s_age: 16 }],
    ['screenout by involvement', { ...PASSES_SCREENING, s_status: 'not_involved' }],
    ['screenout by consent', { ...PASSES_SCREENING, consent: 'declined' }],
  ];

  const edges = new Set(buildFlow(questionnaire).edges.map((e) => `${e.from}→${e.to}`));

  it.each(ROUTES)('draws every transition a %s respondent actually takes', (_name, route) => {
    const { steps } = run(questionnaire, route);
    for (let i = 0; i + 1 < steps.length; i++) {
      expect(edges, `${steps[i].id} → ${steps[i + 1].id} is walked but not drawn`).toContain(
        `${steps[i].id}→${steps[i + 1].id}`,
      );
    }
  });

  it('stays far below the quadratic blow-up it replaced', () => {
    // 70 screens, most of them conditional, produce 1,565 edges under the naive derivation
    expect(buildFlow(questionnaire).edges.length).toBeLessThan(150);
  });

  it('states a reason on every edge that leaves a fork', () => {
    // An edge leaving a fork without a label leaves the admin guessing why the
    // flow splits. A single sequential edge, on the other hand, may stay silent.
    const all = buildFlow(questionnaire).edges;
    const outgoing = new Map<string, number>();
    for (const e of all) outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + 1);
    for (const e of all) {
      if ((outgoing.get(e.from) ?? 0) > 1) {
        expect(e.label, `edge ${e.from} → ${e.to} leaves a fork without a reason`).not.toBe('');
      }
    }
  });
});
