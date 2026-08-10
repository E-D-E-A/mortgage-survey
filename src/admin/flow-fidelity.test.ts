// התרשים בקונסולה חייב לספר את מה שהמנוע *עושה*. זו הבדיקה שמונעת את התקלה
// שדרישה 2 מכוונת אליה: אדמין מסתכל על תרשים, מאשר אותו, מפרסם — והמשיבים
// עוברים מסלול אחר.
//
// הכיוון שנבדק הוא **שלמות**: כל מעבר שהמנוע יכול לבצע בפועל חייב להופיע
// כקשת בתרשים. הכיוון ההפוך (קשת שאין לה קונטקסט) אינו נבדק בכוונה —
// reachability.ts מוגדר במפורש כשמרני ("להסתיר מעבר אמיתי גרוע בהרבה
// מלצייר יותר מדי"), וקשת מעומעמת עודפת היא רעש, לא סכנה.
//
// הבדיקה רצה גם על השאלון האמיתי (כל צירופי הניתוב) וגם על קונפיגים מוגרלים,
// כדי שגם שאלון עתידי — שאף אחד עוד לא כתב — יהיה מכוסה.

import { describe, expect, it } from 'vitest';
import { evaluate } from '../engine/conditions';
import { findNext } from '../engine/navigation';
import { simulatePath } from '../engine/path';
import { validateConfig } from '../engine/validate';
import type { Answers, Condition, Screen, SurveyConfig, SurveyContext } from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';
import { buildFlow, describeCondition, nodeText } from './graph';
import { fallThroughTargets } from './reachability';

// ─────────────────────── הליכה במנוע (כמו ב-App.tsx) ───────────────────────

interface Walk {
  path: string[];
  transitions: [string, string][];
  vars: Record<string, unknown>;
  looped: boolean;
}

/**
 * מריץ את הניווט בדיוק כמו App.submit: מחיל onSubmit על אותו ctx, ואז findNext.
 * מסך בלי תשובה ב-`answers` נחשב "לא ענה" — גם זה מצב אמיתי.
 */
function walk(config: SurveyConfig, answers: Answers): Walk {
  const ctx: SurveyContext = { answers: {}, vars: {} };
  const path: string[] = [];
  const transitions: [string, string][] = [];
  let current: Screen | null = config.screens[0] ?? null;

  for (let guard = 0; current && guard < 300; guard++) {
    path.push(current.id);
    if (current.type === 'end') return { path, transitions, vars: ctx.vars, looped: false };
    if (current.id in answers) ctx.answers[current.id] = answers[current.id];
    for (const rule of current.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) ctx.vars[rule.var] = rule.value;
    }
    const next: Screen | null = findNext(config, current, ctx);
    if (next) transitions.push([current.id, next.id]);
    current = next;
  }
  return { path, transitions, vars: ctx.vars, looped: current !== null };
}

const edgeKey = ([from, to]: [string, string]) => `${from} → ${to}`;

function drawnEdges(config: SurveyConfig): Set<string> {
  return new Set(buildFlow(config).edges.map((e) => edgeKey([e.from, e.to])));
}

/** כל המעברים שהמנוע יכול לבצע על פני קבוצת קונטקסטים. */
function realTransitions(config: SurveyConfig, contexts: Answers[]): Map<string, Answers> {
  const found = new Map<string, Answers>();
  for (const answers of contexts) {
    for (const t of walk(config, answers).transitions) {
      if (!found.has(edgeKey(t))) found.set(edgeKey(t), answers);
    }
  }
  return found;
}

// ─────────────────── כל צירופי הניתוב של השאלון האמיתי ───────────────────

const REAL_CONTEXTS: Answers[] = [];
for (const consent of ['agreed', 'declined']) {
  for (const s_age of [17, 35]) {
    for (const s_status of ['active', 'past5', 'none', 'dontknow', 'not_involved']) {
      for (const s_timeline of ['m0_3', 'm4_6', 'm7_12', 'm13_24', 'later', 'unknown', 'never']) {
        for (const s_actions of [['budget'], ['bank'], ['search'], ['docs'], ['none'], []]) {
          REAL_CONTEXTS.push({ consent, s_age, s_status, s_timeline, s_actions });
        }
      }
    }
  }
}

describe('the flow graph matches the engine — the real questionnaire', () => {
  const real = realTransitions(questionnaire, REAL_CONTEXTS);
  const drawn = drawnEdges(questionnaire);

  it('covers every routing combination the screening questions allow', () => {
    expect(REAL_CONTEXTS.length).toBe(2 * 2 * 5 * 7 * 6);
    expect(real.size).toBeGreaterThan(30);
  });

  it('draws an edge for every transition a respondent can actually take', () => {
    const missing = [...real.keys()].filter((key) => !drawn.has(key));
    expect(
      missing,
      `the console would hide these real transitions: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('draws a node for every screen, in the order of the questionnaire', () => {
    const flow = buildFlow(questionnaire);
    expect(flow.nodes.map((n) => n.id)).toEqual(questionnaire.screens.map((s) => s.id));
    for (const node of flow.nodes) expect(node.text).toBe(nodeText(node.screen));
  });

  it('never draws an edge to or from a screen that is not on the diagram', () => {
    const flow = buildFlow(questionnaire);
    const ids = new Set(flow.nodes.map((n) => n.id));
    for (const edge of flow.edges) {
      expect(ids).toContain(edge.from);
      expect(ids).toContain(edge.to);
    }
  });

  it('never draws an outgoing edge from an end screen', () => {
    const ends = new Set(
      questionnaire.screens.filter((s) => s.type === 'end').map((s) => s.id),
    );
    for (const edge of buildFlow(questionnaire).edges) expect(ends.has(edge.from)).toBe(false);
  });

  it('marks a screen unreachable only when no respondent can reach it', () => {
    const visited = new Set(REAL_CONTEXTS.flatMap((answers) => walk(questionnaire, answers).path));
    const flagged = validateConfig(questionnaire)
      .filter((i) => i.code === 'unreachable')
      .map((i) => i.screenId);
    for (const id of flagged) expect(visited.has(id!), `"${id}" is reachable in practice`).toBe(false);
  });
});

describe('the path preview in the console is the path the respondent walks', () => {
  it('simulatePath agrees with the engine on every routing combination', () => {
    for (const answers of REAL_CONTEXTS) {
      const expected = walk(questionnaire, answers);
      const preview = simulatePath(questionnaire, answers);
      expect(preview.map((s) => s.screen.id), JSON.stringify(answers)).toEqual(expected.path);
      // המשתנים שהקונסולה מציגה ליד כל צעד הם אלה שהמנוע צבר עד שם
      expect(preview.at(-1)?.vars ?? {}).toEqual(expected.vars);
    }
  });
});

describe('the edge labels read as the respondent would read them', () => {
  it('spells out option wording instead of the analysis code', () => {
    const flow = buildFlow(questionnaire);
    let checked = 0;
    for (const screen of questionnaire.screens) {
      (screen.next ?? []).forEach((rule, ruleIndex) => {
        const cond = rule.if;
        if (!cond || !('q' in cond) || (cond.op !== 'eq' && cond.op !== 'in')) return;
        const target = questionnaire.screens.find((s) => s.id === cond.q);
        if (!target || (target.type !== 'single' && target.type !== 'multi')) return;
        const values = Array.isArray(cond.value) ? cond.value : [cond.value];
        const labels = values.map((v) => target.options.find((o) => o.id === v)?.label);
        if (labels.some((l) => !l)) return;
        const edge = flow.edges.find(
          (e) => e.from === screen.id && e.to === rule.goto && e.ruleIndex === ruleIndex,
        );
        expect(edge, `no edge for ${screen.id} → ${rule.goto}`).toBeDefined();
        for (const label of labels) expect(edge!.label).toContain(label!);
        checked++;
      });
    }
    expect(checked, 'no conditional goto rules were checked').toBeGreaterThan(0);
  });

  it('names session marks by their Hebrew label, not the variable name', () => {
    const cond: Condition = { var: 'segment', op: 'eq', value: 'A' };
    const text = describeCondition(cond, questionnaire.screens, questionnaire.varMeta);
    expect(text).toBe('יש או הייתה משכנתה');
    expect(text).not.toContain('segment');
  });

  it('gives every conditional goto edge a label a human can act on', () => {
    for (const edge of buildFlow(questionnaire).edges) {
      if (edge.kind !== 'goto') continue;
      expect(edge.label.trim(), `edge ${edge.from} → ${edge.to} has no label`).not.toBe('');
    }
  });
});

// ──────────────────────────── קונפיגים מוגרלים ────────────────────────────

/** PRNG עם זרע — נפילה חוזרת על עצמה בדיוק, אחרת אין מה לתקן. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPTION_IDS = ['x', 'y', 'z'];

/**
 * שאלון מוגרל: 6–10 מסכים, תנאי תצוגה על תשובות ועל סימון סשן, כללי goto
 * קדימה, ומסך סיום. הגרלה קדימה בלבד — מעגלים נבדקים בנפרד ובמכוון.
 */
function randomConfig(seed: number): SurveyConfig {
  const rand = rng(seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const count = 6 + Math.floor(rand() * 5);
  const questionIds = ['q0', 'q1', 'q2'];

  const screens: Screen[] = [];
  for (let i = 0; i < count; i++) {
    const id = i < 3 ? questionIds[i] : `s${i}`;
    const conditionOn = rand();
    let showIf: Condition | undefined;
    if (i > 0 && conditionOn < 0.55) {
      const q = pick(questionIds.slice(0, Math.min(i, 3)));
      showIf =
        rand() < 0.5
          ? { q, op: 'eq', value: pick(OPTION_IDS) }
          : { q, op: 'in', value: [pick(OPTION_IDS), pick(OPTION_IDS)] };
      if (rand() < 0.3) showIf = { all: [showIf, { var: 'mark', op: 'eq', value: 'm1' }] };
    }
    screens.push({
      id,
      type: 'single',
      prompt: `שאלה ${id}`,
      options: OPTION_IDS.map((o) => ({ id: o, label: `אפשרות ${o}` })),
      ...(showIf ? { showIf } : {}),
      // סימון סשן מוצב בזוג משלים, כמו האינווריאנטה בשאלון האמיתי
      ...(i === 0
        ? {
            onSubmit: [
              { var: 'mark', value: 'm1', if: { q: 'q0', op: 'eq', value: 'x' } },
              { var: 'mark', value: 'm2', if: { not: { q: 'q0', op: 'eq', value: 'x' } } },
            ],
          }
        : {}),
    } as Screen);
  }

  // כללי ניתוב קדימה, אל מסך שקיים
  for (let i = 0; i < screens.length; i++) {
    if (rand() > 0.35) continue;
    const targets = screens.slice(i + 1).map((s) => s.id);
    if (targets.length === 0) continue;
    const goto = pick(targets);
    screens[i] = {
      ...screens[i],
      next: rand() < 0.6 ? [{ if: { q: 'q0', op: 'eq', value: 'z' }, goto }] : [{ goto }],
    } as Screen;
  }

  screens.push({ id: 'end_complete', type: 'end', variant: 'complete', title: 'סוף', body: '' });
  delete (screens[0] as { showIf?: Condition }).showIf; // המסך הראשון תמיד מוצג
  return { version: `fuzz-${seed}`, varMeta: {}, screens };
}

/** כל צירופי התשובות לשלוש השאלות המנתבות, כולל "לא ענה". */
const FUZZ_CONTEXTS: Answers[] = [];
for (const q0 of [...OPTION_IDS, undefined]) {
  for (const q1 of [...OPTION_IDS, undefined]) {
    for (const q2 of [...OPTION_IDS, undefined]) {
      const answers: Answers = {};
      if (q0) answers.q0 = q0;
      if (q1) answers.q1 = q1;
      if (q2) answers.q2 = q2;
      FUZZ_CONTEXTS.push(answers);
    }
  }
}

const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

describe('the flow graph matches the engine — on questionnaires nobody wrote yet', () => {
  it('draws every transition the engine can take, in 120 random configs', () => {
    for (const seed of SEEDS) {
      const config = randomConfig(seed);
      const drawn = drawnEdges(config);
      const real = realTransitions(config, FUZZ_CONTEXTS);
      const missing = [...real.keys()].filter((key) => !drawn.has(key));
      expect(missing, `seed ${seed}: hidden transitions ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('lists every landing a forward scan can really reach (reachability pruning is safe)', () => {
    for (const seed of SEEDS) {
      const config = randomConfig(seed);
      const { screens } = config;
      // הנחיתות בפועל: מכל מסך, לאן המנוע ממשיך כשאין כלל goto שנתפס
      const actual = new Map<number, Set<string>>();
      for (const answers of FUZZ_CONTEXTS) {
        const ctx: SurveyContext = { answers: {}, vars: {} };
        let current: Screen | null = screens[0];
        for (let guard = 0; current && guard < 300; guard++) {
          const index = screens.findIndex((s) => s.id === current!.id);
          if (current.type === 'end') break;
          if (current.id in answers) ctx.answers[current.id] = answers[current.id];
          for (const rule of current.onSubmit ?? []) {
            if (!rule.if || evaluate(rule.if, ctx)) ctx.vars[rule.var] = rule.value;
          }
          const jumped = (current.next ?? []).some((r) => !r.if || evaluate(r.if, ctx));
          const next: Screen | null = findNext(config, current, ctx);
          if (next && !jumped) {
            if (!actual.has(index)) actual.set(index, new Set());
            actual.get(index)!.add(next.id);
          }
          current = next;
        }
      }
      for (const [index, landings] of actual) {
        const listed = new Set(fallThroughTargets(screens, index).map((s) => s.id));
        for (const id of landings) {
          expect(
            listed.has(id),
            `seed ${seed}: screen ${screens[index].id} can land on "${id}", which the console omits`,
          ).toBe(true);
        }
      }
    }
  });

  it('reports a cycle whenever the engine can really loop', () => {
    const loop: SurveyConfig = {
      version: 'loop',
      screens: [
        { id: 'a', type: 'info', title: 'א', body: '' },
        { id: 'b', type: 'info', title: 'ב', body: '', next: [{ goto: 'a' }] },
        { id: 'end_complete', type: 'end', variant: 'complete', title: 'סוף', body: '' },
      ],
    };
    // המנוע עצמו נתקע — visitedPath/App היו מסתובבים בלי סוף
    expect(walk(loop, {}).looped).toBe(true);
    expect(validateConfig(loop).some((i) => i.code === 'cycle' && i.level === 'error')).toBe(true);
  });

  it('never reports a cycle in a forward-only config, and never loops there', () => {
    for (const seed of SEEDS) {
      const config = randomConfig(seed);
      expect(validateConfig(config).filter((i) => i.code === 'cycle')).toEqual([]);
      for (const answers of FUZZ_CONTEXTS) {
        expect(walk(config, answers).looped, `seed ${seed}`).toBe(false);
      }
    }
  });
});

