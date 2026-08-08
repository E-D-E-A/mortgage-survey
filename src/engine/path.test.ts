import { describe, expect, it } from 'vitest';
import { evaluate } from './conditions';
import { findNext } from './navigation';
import { progressRatio, pruneAnswers, simulatePath, visitedPath } from './path';
import type { AnswerValue, Answers, Screen, SurveyConfig, SurveyContext, Vars } from './types';
import { questionnaire } from '../questionnaire/survey-v1';
import { buildFlow } from '../admin/graph';

/**
 * סימולציה של משיב אמיתי: עונה, מפעיל onSubmit ועובר ל-findNext — בדיוק
 * הסדר שב-App.submit. `route` קובע את התשובות שמנתבות; לכל שאר המסכים נבחרת
 * תשובה תקינה כלשהי.
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

/** תשובות סינון שעוברות: גיל 40 (16 היה מפעיל את ה-screenout של הקטינים). */
const PASSES_SCREENING: Record<string, AnswerValue> = { s_age: 40 };

/** מסלול A: קיימת משכנתה. */
const ROUTE_A: Record<string, AnswerValue> = { ...PASSES_SCREENING, s_status: 'active' };

/** מסלול B: אין משכנתה, צפי קרוב ופעולה ממשית. */
const ROUTE_B: Record<string, AnswerValue> = {
  ...PASSES_SCREENING,
  s_status: 'none',
  s_timeline: 'm0_3',
  s_actions: ['bank'],
};

/** אותו מסלול, אחרי שהמשיב חזר אחורה ל-s_actions ובחר "לא ביצעתי" — מקטע C. */
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
    const { steps } = run(questionnaire, { ...PASSES_SCREENING, s_role: 'none' });
    expect(steps[steps.length - 1].id).toBe('end_screenout');
    expect(steps.map((s) => s.id)).not.toContain('d_gender');
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
    // המשיב ענה על b_deal_type במסלול B, ואז חזר ושינה את s_actions ל-C
    const { answers, vars } = run(questionnaire, ROUTE_C);
    const stale = { ...answers, b_deal_type: 'first', b_stage: 'budget' };

    const pruned = pruneAnswers(questionnaire, { answers: stale, vars });

    expect(pruned).not.toHaveProperty('b_deal_type');
    expect(pruned).not.toHaveProperty('b_stage');
    // ושום דבר מהמסלול שהמשיב באמת עבר לא נעלם
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
  /** מה שהמשיב באמת רואה: המקסימום הרץ (App.tsx לא נותן לפס לסגת). */
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
    // ב-a_commit נשארו 8 מסכים מתוך 32 — הפס חייב להיות גבוה, לא 38%
    const { steps } = run(questionnaire, ROUTE_A);
    const atCommit = steps.find((s) => s.id === 'a_commit')!;
    expect(Math.round(atCommit.progress * 100)).toBeGreaterThan(70);
  });

  it('returns 0 for a screen that is not on the path', () => {
    expect(progressRatio(questionnaire, 'b_deal_type', { answers: {}, vars: { segment: 'A' } })).toBe(0);
  });
});

describe('simulatePath', () => {
  // הסימולטור בקונסולה מבטיח לאדמין "זה בדיוק מה שיקרה". הבדיקה הזו היא
  // ההבטחה עצמה: אותו מסלול ואותם משתנים כמו הרצה מלאה של המנוע.
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
});

describe('the flow graph never lies by omission', () => {
  // התרשים גוזם מעברים שאינם אפשריים כדי להיות קריא. כישלון הגיזום המסוכן
  // אינו עומס אלא הסתרה: מעבר אמיתי שאין לו קשת. זו הבדיקה שחוסמת אותו.
  const ROUTES: [string, Record<string, AnswerValue>][] = [
    ['A', ROUTE_A],
    ['B', ROUTE_B],
    ['C', ROUTE_C],
    ['screenout by age', { ...PASSES_SCREENING, s_age: 16 }],
    ['screenout by role', { ...PASSES_SCREENING, s_role: 'none' }],
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
    // 70 מסכים שרובם מותנים ייצרו 1,565 קשתות בגזירה הנאיבית
    expect(buildFlow(questionnaire).edges.length).toBeLessThan(150);
  });
});
