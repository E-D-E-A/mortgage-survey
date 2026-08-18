// Static validation of a SurveyConfig: graph integrity (cycles, dangling gotos,
// reachability), reference integrity (condition q/var refs), and the onSubmit
// totality invariant documented in src/questionnaire/placeholder.ts.
//
// Shared verbatim between the admin editor (live feedback) and the publish
// Netlify function (server-side gate) — esbuild bundles this file into both.

import { interpolatedTexts, interpolationRefs } from './conditions';
import { quotaCells, quotaFullScreen, type QuotaCell } from './quota';
import type { Condition, Option, Screen, SurveyConfig } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code:
    | 'empty-config'
    | 'empty-id'
    | 'duplicate-id'
    | 'dangling-goto'
    | 'unknown-ref'
    | 'cycle'
    | 'unreachable'
    | 'no-end-screen'
    | 'no-end-reachable'
    | 'var-totality'
    | 'first-screen-showif'
    | 'empty-text'
    | 'no-choices'
    | 'empty-choice-id'
    | 'duplicate-choice-id'
    | 'unknown-option'
    | 'scale-range'
    | 'bad-max-selections'
    | 'bad-text-limit'
    | 'var-order'
    | 'random-var-values'
    | 'random-var-overwritten'
    | 'unknown-interpolation'
    | 'unknown-draw-value'
    | 'quota';
  screenId?: string;
  message: string;
}

type Leaf =
  | { q: string; op: string; value?: unknown }
  | { var: string; op: string; value?: unknown };

/** Operators whose value is meant to be an option id on the screen they point at. */
const OPTION_VALUE_OPS = new Set(['eq', 'ne', 'in', 'includes', 'includesAny']);

/** The screen's choice options, or null for a screen that has none. */
function optionsOf(screen: Screen): Option[] | null {
  return screen.type === 'single' || screen.type === 'multi' ? screen.options : null;
}

/** The heading the respondent sees, and the name of the field holding it (for the Hebrew message). */
function headingOf(screen: Screen): { text: unknown; field: string } {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return { text: screen.title, field: 'כותרת' };
    default:
      return { text: screen.prompt, field: 'נוסח שאלה' };
  }
}

/**
 * Integrity of an item list (options on a choice screen, rows in a matrix): a
 * non-empty list, ids that exist and are unique, and labels that are not blank.
 * Each of these breaks either the screen for the respondent or the coding in
 * analysis.
 */
function checkChoiceList(
  screenId: string,
  kind: 'אפשרות' | 'שורה',
  items: { id: string; label: string }[],
  emptyMessage: string,
  issues: ValidationIssue[],
): void {
  if (items.length === 0) {
    issues.push({ level: 'error', code: 'no-choices', screenId, message: emptyMessage });
    return;
  }
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (typeof item.id !== 'string' || !item.id.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-choice-id',
        screenId,
        message: `ל${kind} ${i + 1} במסך "${screenId}" אין קוד לקובץ הנתונים — התשובה תגיע לניתוח בלי שם`,
      });
    } else if (seen.has(item.id)) {
      issues.push({
        level: 'error',
        code: 'duplicate-choice-id',
        screenId,
        message: `הקוד "${item.id}" חוזר ביותר מ${kind} אחת במסך "${screenId}" — בניתוח אי אפשר יהיה להבחין ביניהן`,
      });
    } else {
      seen.add(item.id);
    }
    if (typeof item.label !== 'string' || !item.label.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-text',
        screenId,
        message: `ל${kind} ${i + 1} במסך "${screenId}" אין נוסח — המשיב יראה שורה ריקה`,
      });
    }
  });
}

function collectLeaves(cond: Condition, out: Leaf[]): void {
  if ('all' in cond) cond.all.forEach((c) => collectLeaves(c, out));
  else if ('any' in cond) cond.any.forEach((c) => collectLeaves(c, out));
  else if ('not' in cond) collectLeaves(cond.not, out);
  else out.push(cond);
}

/** Every condition that appears on a screen: showIf, next[].if, onSubmit[].if */
export function screenConditions(screen: Screen): Condition[] {
  const out: Condition[] = [];
  if (screen.showIf) out.push(screen.showIf);
  for (const r of screen.next ?? []) if (r.if) out.push(r.if);
  for (const r of screen.onSubmit ?? []) if (r.if) out.push(r.if);
  return out;
}

/**
 * A screen's outgoing edges, following findNext's semantics:
 * - every goto target in the next rules (rules after an unconditional one are
 *   dead code and are not counted);
 * - with no unconditional rule — fall-through: the next screen in the array, and
 *   as long as that screen has a showIf (meaning it may be skipped) the one
 *   after it too, up to the first screen with no showIf.
 * - an end screen has no edges (the session is over).
 * - a screen that marks a capped value also reaches the quota-full screen. That
 *   edge is written by no one: findNext adds it from the quota state, which is
 *   the entire point of the feature. Leaving it out of the graph made every
 *   survey with a quota report its quota-full screen as unreachable — a warning
 *   about the one screen that was wired correctly.
 */
function edgesFrom(
  screens: Screen[],
  idToIndex: Map<string, number>,
  index: number,
  quotaExit?: (screen: Screen) => number | null,
): number[] {
  const screen = screens[index];
  if (screen.type === 'end') return [];
  const targets: number[] = [];
  const viaQuota = quotaExit?.(screen);
  if (viaQuota !== undefined && viaQuota !== null) targets.push(viaQuota);
  let unconditional = false;
  for (const rule of screen.next ?? []) {
    const t = idToIndex.get(rule.goto);
    if (t !== undefined) targets.push(t);
    if (!rule.if) {
      unconditional = true;
      break;
    }
  }
  if (!unconditional) {
    for (let j = index + 1; j < screens.length; j++) {
      targets.push(j);
      if (!screens[j].showIf) break;
    }
  }
  return targets;
}

/** Whether one screen's onSubmit rules for a variable are "total" — they always assign a value. */
function assignsTotally(screen: Screen, varName: string): boolean {
  const rules = (screen.onSubmit ?? []).filter((r) => r.var === varName);
  if (rules.some((r) => !r.if)) return true;
  // A complementary pair: a rule with condition X and a rule with condition not(X)
  for (const a of rules) {
    for (const b of rules) {
      if (a === b || !a.if || !b.if) continue;
      if ('not' in b.if && JSON.stringify(b.if.not) === JSON.stringify(a.if)) return true;
    }
  }
  return false;
}

/**
 * A condition value that is meant to be an option id — and is not one of the
 * options on the screen it points at. This is what happens when an option's id
 * is renamed or the option is deleted: the condition stays syntactically valid,
 * and the branch simply dies with no outward sign.
 *
 * ⚠ Only string values are checked. A comparison against a number (on a screen
 * that used to be of another type, say) may well be intentional, and a false
 * warning here is worse than a miss.
 */
function checkOptionValues(
  screenId: string,
  leaf: { q: string; op: string; value?: unknown },
  screens: Screen[],
  idToIndex: Map<string, number>,
  issues: ValidationIssue[],
): void {
  if (!OPTION_VALUE_OPS.has(leaf.op)) return;
  const targetIndex = idToIndex.get(leaf.q);
  if (targetIndex === undefined) return; // already reported as unknown-ref
  const options = optionsOf(screens[targetIndex]);
  if (!options) return;

  const ids = new Set(options.map((o) => o.id));
  const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  for (const value of values) {
    if (typeof value !== 'string' || ids.has(value)) continue;
    // ne is the mirror image: a value that does not exist makes the condition always true, not a dead branch
    const effect =
      leaf.op === 'ne' ? 'התנאי יתקיים אצל כל משיב' : 'המסלול הזה לעולם לא ייפתח';
    issues.push({
      level: 'error',
      code: 'unknown-option',
      screenId,
      message: `תנאי במסך "${screenId}" מחפש את התשובה "${value}" בשאלה "${leaf.q}", אבל אין שם אפשרות כזאת — ${effect}`,
    });
  }
}

/**
 * A condition that compares a draw against a value the draw cannot produce.
 *
 * This is what editing a draw's value looks like from the condition's side: the
 * list moves on, the condition keeps naming the value that used to be there, and
 * no respondent will ever hold it again. The branch dies in silence — the same
 * failure checkOptionValues catches for questions, arriving by a different door.
 *
 * ⚠ Only the operators whose value is meant to name one of the draw's values.
 * `gt` and `lt` compare against a threshold, which is deliberately not one of
 * them — a price experiment asking "above 100" names no arm at all.
 */
function checkDrawValues(
  screenId: string,
  leaf: { var: string; op: string; value?: unknown },
  config: SurveyConfig,
  issues: ValidationIssue[],
): void {
  if (!OPTION_VALUE_OPS.has(leaf.op)) return;
  const draw = config.randomVars?.[leaf.var];
  if (!draw) return;

  const known = new Set(draw.map((v) => String(v)));
  for (const value of Array.isArray(leaf.value) ? leaf.value : [leaf.value]) {
    if (value === undefined || value === null || known.has(String(value))) continue;
    // ne is the mirror image, exactly as it is for an option id: a value the draw
    // cannot produce makes the condition true for everyone, not dead
    const effect = leaf.op === 'ne' ? 'התנאי יתקיים אצל כל משיב' : 'המסלול הזה לעולם לא ייפתח';
    issues.push({
      level: 'error',
      code: 'unknown-draw-value',
      screenId,
      message: `תנאי במסך "${screenId}" מחפש בהגרלה "${leaf.var}" את הערך "${String(value)}", שאינו ברשימת הערכים שלה — ${effect}`,
    });
  }
}

export function validateConfig(config: SurveyConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const screens = config.screens ?? [];

  if (screens.length === 0) {
    return [{ level: 'error', code: 'empty-config', message: 'השאלון ריק — אין בו אף מסך' }];
  }

  // --- identities ---
  const idToIndex = new Map<string, number>();
  screens.forEach((s, i) => {
    if (!s.id || !s.id.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-id',
        message: `למסך במקום ${i + 1} אין קוד לקובץ הנתונים`,
      });
      return;
    }
    if (idToIndex.has(s.id)) {
      issues.push({
        level: 'error',
        code: 'duplicate-id',
        screenId: s.id,
        message: `הקוד "${s.id}" מופיע ביותר ממסך אחד — לכל מסך צריך קוד משלו`,
      });
      return;
    }
    idToIndex.set(s.id, i);
  });

  if (screens[0]?.showIf) {
    issues.push({
      level: 'error',
      code: 'first-screen-showif',
      screenId: screens[0].id,
      message: `המסך הראשון ("${screens[0].id}") מוצג בתנאי — המסך הראשון חייב להופיע לכל מי שנכנס לשאלון`,
    });
  }

  if (!screens.some((s) => s.type === 'end')) {
    issues.push({
      level: 'error',
      code: 'no-end-screen',
      message: 'אין בשאלון אף מסך סיום — למשיב אין איפה לסיים',
    });
  }

  // --- random variables ---
  // The draw happens once on entry (initVars in App.tsx) and the value is fixed
  // for that respondent from then on. A list of one value is not an experiment —
  // every respondent gets the same value, and the two arms the admin thought
  // they were measuring are one arm. An empty value is worse still: whoever
  // draws it reads a hole in the middle of the question.
  for (const [name, values] of Object.entries(config.randomVars ?? {})) {
    const list = Array.isArray(values) ? values : [];
    if (list.length < 2) {
      issues.push({
        level: 'error',
        code: 'random-var-values',
        message: `להגרלה "${name}" יש ${list.length === 1 ? 'ערך אחד בלבד' : 'רשימת ערכים ריקה'} — צריך לפחות שני ערכים, אחרת אין כאן הגרלה`,
      });
    }
    if (list.some((v) => typeof v === 'string' && !v.trim())) {
      issues.push({
        level: 'error',
        code: 'random-var-values',
        message: `להגרלה "${name}" יש ערך ריק — מי שיוגרל אליו יראה חור בנוסח השאלה`,
      });
    }
    const seen = new Set<string>();
    for (const v of list) {
      const key = String(v);
      if (seen.has(key)) {
        issues.push({
          level: 'warning',
          code: 'random-var-values',
          message: `הערך "${key}" מופיע יותר מפעם אחת בהגרלה "${name}" — הסיכוי שלו כפול משאר הערכים`,
        });
        break;
      }
      seen.add(key);
    }
  }

  // A draw is settled once, on entry, and only read from then on — that is the
  // whole difference between an experiment and per-screen randomisation. A
  // marking rule that assigns the same name overwrites the value the respondent
  // was actually shown: the question said 149, and the completion event reports
  // whatever the rule put there instead, so the arm recorded in analysis is not
  // the arm that ran.
  //
  // ⚠ This is two clicks away in the console, not a hand-edited-JSON curiosity.
  // The "which mark does this screen set" list is built from makeNaming
  // (admin/display.ts), which seeds itself with the draws — deliberately, because
  // conditions must be able to branch on the arm. One list feeds two menus with
  // opposite needs, and nothing about the result looks wrong afterwards.
  const drawnNames = new Set(Object.keys(config.randomVars ?? {}));
  const overwritten = new Set<string>();
  for (const s of screens) {
    for (const rule of s.onSubmit ?? []) {
      if (!drawnNames.has(rule.var) || overwritten.has(`${s.id} ${rule.var}`)) continue;
      overwritten.add(`${s.id} ${rule.var}`);
      issues.push({
        level: 'error',
        code: 'random-var-overwritten',
        screenId: s.id,
        message: `המסך "${s.id}" קובע את "${rule.var}", אבל זו הגרלה שנקבעת פעם אחת בכניסה — הכלל הזה ידרוס את הערך שהוגרל, והתשובה תיזקף בניתוח לזרוע הלא נכונה`,
      });
    }
  }

  // --- quotas ---
  // A quota on a mark value is a promise that someone will enforce it: the
  // moment it fills, the respondent is routed to a "quota already full" end
  // screen (see engine/quota.ts). With no such screen there is nowhere to send
  // them and the quota simply never applies — a silent failure behind a
  // definition that looks perfectly fine.
  const quotas = quotaCells(config);

  if (quotas.length > 0 && !quotaFullScreen(config)) {
    issues.push({
      level: 'error',
      code: 'quota',
      message:
        'יש בשאלון מכסות, אבל אין בו מסך סיום מסוג "כבר נאספו מספיק משיבים כאלה" — אין לאן לשלוח משיב שהמכסה שלו התמלאה',
    });
  }

  // Cells whose ceiling is a usable number. The dead-config check on them waits
  // for the reachability pass further down — see the loop after it.
  const liveCells: QuotaCell[] = [];
  for (const cell of quotas) {
    if (!Number.isInteger(cell.limit) || cell.limit < 0) {
      issues.push({
        level: 'error',
        code: 'quota',
        message: `המכסה של הערך "${cell.value}" בסימון "${cell.mark}" היא ${cell.limit} — צריך מספר שלם מ-0 ומעלה. כדי לא להגביל בכלל, השאירו את השדה ריק`,
      });
      continue;
    }
    liveCells.push(cell);
  }

  // --- screen content integrity ---
  // An edit that looks harmless (renaming an option id, deleting the last
  // option, inverting a scale) can leave the respondent staring at an empty
  // screen, or stuck with no way forward and no way back.
  for (const s of screens) {
    const heading = headingOf(s);
    if (typeof heading.text !== 'string' || !heading.text.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-text',
        screenId: s.id,
        message: `למסך "${s.id}" אין ${heading.field} — המשיב יראה מסך ריק`,
      });
    }

    if (s.type === 'consent' && [s.agreeLabel, s.declineLabel].some((l) => !l || !l.trim())) {
      issues.push({
        level: 'error',
        code: 'empty-text',
        screenId: s.id,
        message: `במסך ההסכמה "${s.id}" אחד הכפתורים בלי כיתוב`,
      });
    }

    const options = optionsOf(s);
    if (options) {
      checkChoiceList(
        s.id,
        'אפשרות',
        options,
        `למסך "${s.id}" אין אף אפשרות לבחירה — כפתור ההמשך יישאר חסום והמשיב ייתקע`,
        issues,
      );
    }

    if (s.type === 'multi' && s.maxSelections !== undefined) {
      if (!Number.isInteger(s.maxSelections) || s.maxSelections < 1) {
        issues.push({
          level: 'error',
          code: 'bad-max-selections',
          screenId: s.id,
          message: `מספר הבחירות המרבי במסך "${s.id}" הוא ${s.maxSelections} — צריך מספר שלם מ-1 ומעלה. כדי לא להגביל בכלל, השאירו את השדה ריק`,
        });
      } else if (s.maxSelections >= s.options.length) {
        issues.push({
          level: 'warning',
          code: 'bad-max-selections',
          screenId: s.id,
          message: `מספר הבחירות המרבי במסך "${s.id}" (${s.maxSelections}) גדול או שווה למספר האפשרויות — הוא לא מגביל דבר`,
        });
      }
    }

    if (s.type === 'text' && s.maxLength !== undefined) {
      if (!Number.isInteger(s.maxLength) || s.maxLength < 1) {
        issues.push({
          level: 'error',
          code: 'bad-text-limit',
          screenId: s.id,
          message: `אורך התשובה המרבי במסך "${s.id}" הוא ${s.maxLength} — צריך מספר שלם מ-1 ומעלה, אחרת אי אפשר להקליד דבר`,
        });
      }
    }

    if (s.type === 'matrix') {
      checkChoiceList(
        s.id,
        'שורה',
        s.items,
        `למטריצה "${s.id}" אין אף שורה — המשיב יראה מסך ריק`,
        issues,
      );
      const { scaleMin, scaleMax } = s;
      if (!Number.isInteger(scaleMin) || !Number.isInteger(scaleMax)) {
        issues.push({
          level: 'error',
          code: 'scale-range',
          screenId: s.id,
          message: `קצות הסולם במטריצה "${s.id}" חייבים להיות מספרים שלמים (כרגע ${scaleMin}–${scaleMax})`,
        });
      } else if (scaleMin > scaleMax) {
        issues.push({
          level: 'error',
          code: 'scale-range',
          screenId: s.id,
          message: `הסולם במטריצה "${s.id}" הפוך (מ-${scaleMin} עד ${scaleMax}) — לא ייווצר אף כפתור והמשיב ייתקע`,
        });
      } else if (scaleMin === scaleMax) {
        issues.push({
          level: 'warning',
          code: 'scale-range',
          screenId: s.id,
          message: `לסולם במטריצה "${s.id}" יש דרגה אחת בלבד (${scaleMin}) — אין כאן מה למדוד`,
        });
      }
    }
  }

  // --- reference integrity ---
  const producedVars = new Set<string>(Object.keys(config.randomVars ?? {}));
  for (const s of screens) for (const r of s.onSubmit ?? []) producedVars.add(r.var);

  for (const s of screens) {
    for (const rule of s.next ?? []) {
      if (!idToIndex.has(rule.goto)) {
        issues.push({
          level: 'error',
          code: 'dangling-goto',
          screenId: s.id,
          message: `המסך "${s.id}" קופץ אל "${rule.goto}" — מסך שלא קיים`,
        });
      }
    }
    const leaves: Leaf[] = [];
    for (const cond of screenConditions(s)) collectLeaves(cond, leaves);
    for (const leaf of leaves) {
      if ('q' in leaf && !idToIndex.has(leaf.q)) {
        issues.push({
          level: 'error',
          code: 'unknown-ref',
          screenId: s.id,
          message: `תנאי במסך "${s.id}" נשען על השאלה "${leaf.q}", שלא קיימת בשאלון`,
        });
      }
      if ('var' in leaf && !producedVars.has(leaf.var) && !leaf.var.startsWith('url_')) {
        issues.push({
          level: 'error',
          code: 'unknown-ref',
          screenId: s.id,
          message: `תנאי במסך "${s.id}" נשען על הסימון "${leaf.var}", שאף מסך לא קובע`,
        });
      }
      if ('q' in leaf) checkOptionValues(s.id, leaf, screens, idToIndex, issues);
      if ('var' in leaf) checkDrawValues(s.id, leaf, config, issues);
    }

    // `{name}` interpolation in the screen text. interpolate leaves the token as
    // it is when there is no value behind it, so a broken reference is not a
    // silent failure: the respondent reads `{price}`, braces and all, inside the
    // question. Pointing at a question is legitimate — interpolate falls back to
    // the answers too.
    const interpolated = new Set<string>();
    for (const text of interpolatedTexts(s)) {
      if (typeof text !== 'string') continue;
      for (const ref of interpolationRefs(text)) {
        if (interpolated.has(ref)) continue;
        interpolated.add(ref);
        if (producedVars.has(ref) || ref.startsWith('url_') || idToIndex.has(ref)) continue;
        issues.push({
          level: 'error',
          code: 'unknown-interpolation',
          screenId: s.id,
          message: `הנוסח במסך "${s.id}" משבץ את {${ref}}, אבל אין בשאלון סימון או שאלה בשם הזה — המשיב יראה את הסוגריים כמו שהן`,
        });
      }
    }
  }

  // With broken identities the graph checks are pointless — their results would mislead
  if (issues.some((i) => i.code === 'duplicate-id' || i.code === 'empty-id')) return issues;

  // The implicit edge findNext draws from any screen that marks a capped value
  // to the quota-full screen — see edgesFrom.
  const quotaFullIndex = screens.findIndex((s) => s.type === 'end' && s.variant === 'quotafull');
  const cappedCells = new Set(quotas.map((cell) => `${cell.mark} ${cell.value}`));
  const quotaExit = (screen: Screen): number | null =>
    quotaFullIndex >= 0 &&
    (screen.onSubmit ?? []).some((r) => cappedCells.has(`${r.var} ${String(r.value)}`))
      ? quotaFullIndex
      : null;

  // --- graph: cycles ---
  // Colouring: 0=white 1=grey (on the current path) 2=black. An edge into grey = a cycle.
  const color = new Array<number>(screens.length).fill(0);
  const stack: number[] = [];
  let cycleReported = false;

  function dfs(u: number): void {
    color[u] = 1;
    stack.push(u);
    for (const v of edgesFrom(screens, idToIndex, u, quotaExit)) {
      if (cycleReported) return;
      if (color[v] === 1) {
        const start = stack.indexOf(v);
        const path = [...stack.slice(start), v].map((i) => screens[i].id);
        issues.push({
          level: 'error',
          code: 'cycle',
          screenId: screens[v].id,
          // Ids in quotes so the console can swap them for the screen names
          message: `הזרימה חוזרת על עצמה: ${path.map((id) => `"${id}"`).join(' ← ')} — משיב עלול להסתובב כאן בלי סוף`,
        });
        cycleReported = true;
        return;
      }
      if (color[v] === 0) dfs(v);
    }
    stack.pop();
    color[u] = 2;
  }
  for (let i = 0; i < screens.length && !cycleReported; i++) if (color[i] === 0) dfs(i);

  // --- graph: reachability from the first screen ---
  const reachable = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of edgesFrom(screens, idToIndex, u, quotaExit)) {
      if (!reachable.has(v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }

  screens.forEach((s, i) => {
    if (!reachable.has(i)) {
      issues.push({
        level: 'warning',
        code: 'unreachable',
        screenId: s.id,
        message: `אי אפשר להגיע למסך "${s.id}" מהמסך הראשון — אף משיב לא יראה אותו`,
      });
    }
  });

  // A value no screen ever sets will never be counted, so its quota is dead
  // config: it looks active in the console and will stop no one.
  //
  // ⚠ Reachable, not merely present. A setter sitting on a screen no respondent
  // can arrive at is exactly as useless as no setter at all, and that case used
  // to slip through: the admin got an "unreachable screen" notice that never
  // mentioned the quota it had just silently disabled.
  for (const { mark, value } of liveCells) {
    const setBy = screens.some(
      (s, i) =>
        reachable.has(i) &&
        (s.onSubmit ?? []).some((r) => r.var === mark && String(r.value) === value),
    );
    if (!setBy) {
      issues.push({
        level: 'warning',
        code: 'quota',
        message: `יש מכסה לערך "${value}" של הסימון "${mark}", אבל אף מסך שאפשר להגיע אליו לא קובע את הערך הזה — אין מה לספור והמכסה לא תיאכף`,
      });
    }
  }

  if (
    screens.some((s) => s.type === 'end') &&
    !screens.some((s, i) => s.type === 'end' && reachable.has(i))
  ) {
    issues.push({
      level: 'error',
      code: 'no-end-reachable',
      message: 'אי אפשר להגיע מהמסך הראשון לאף מסך סיום — אין למשיב איך לסיים',
    });
  }

  // --- order: a variable tested before it is assigned ---
  // A single drag of the mouse can move a conditional screen ahead of the screen
  // that produces its variable. The result is completely silent: the screen is
  // simply never shown to anyone, because at the moment the condition is tested
  // the variable still has no value.
  //
  // showIf is tested *before* the screen is submitted and so needs a producer on
  // a strictly earlier screen; next and onSubmit rules are tested after the
  // screen's own onSubmit rules have already run (App.tsx applies them to the
  // same ctx), so for those the screen itself counts as a legitimate producer.
  //
  // A warning and not an error: goto rules can change the order of arrival in
  // practice, and the array order is only the default.
  const varProducers = new Map<string, number[]>();
  screens.forEach((s, i) => {
    for (const rule of s.onSubmit ?? []) {
      varProducers.set(rule.var, [...(varProducers.get(rule.var) ?? []), i]);
    }
  });

  screens.forEach((s, i) => {
    const selfRules = [...(s.next ?? []), ...(s.onSubmit ?? [])];
    const groups: { conditions: Condition[]; latestProducer: number }[] = [
      { conditions: s.showIf ? [s.showIf] : [], latestProducer: i - 1 },
      { conditions: selfRules.flatMap((r) => (r.if ? [r.if] : [])), latestProducer: i },
    ];
    const reported = new Set<string>();
    for (const { conditions, latestProducer } of groups) {
      const leaves: Leaf[] = [];
      for (const cond of conditions) collectLeaves(cond, leaves);
      for (const leaf of leaves) {
        if (!('var' in leaf) || reported.has(leaf.var)) continue;
        if (leaf.var.startsWith('url_')) continue;
        if (config.randomVars && leaf.var in config.randomVars) continue;
        const producers = varProducers.get(leaf.var);
        if (!producers || producers.length === 0) continue; // already reported as unknown-ref
        if (producers.some((p) => p <= latestProducer)) continue;
        reported.add(leaf.var);
        issues.push({
          level: 'warning',
          code: 'var-order',
          screenId: s.id,
          message: `המסך "${s.id}" נשען על הסימון "${leaf.var}", אבל כל המסכים שקובעים אותו באים אחריו — כשהתנאי נבדק הסימון עדיין ריק`,
        });
      }
    }
  });

  // --- the onSubmit totality invariant ---
  // A variable used in conditions has to be assigned totally on at least one
  // screen; otherwise going back and changing an answer can leave the old value
  // in place (see placeholder.ts).
  const varsUsedInConditions = new Set<string>();
  for (const s of screens) {
    const leaves: Leaf[] = [];
    for (const cond of screenConditions(s)) collectLeaves(cond, leaves);
    for (const leaf of leaves) if ('var' in leaf) varsUsedInConditions.add(leaf.var);
  }
  for (const varName of varsUsedInConditions) {
    if (varName.startsWith('url_')) continue;
    if (config.randomVars && varName in config.randomVars) continue;
    const settingScreens = screens.filter((s) => (s.onSubmit ?? []).some((r) => r.var === varName));
    if (settingScreens.length === 0) continue; // already reported as unknown-ref
    if (!settingScreens.some((s) => assignsTotally(s, varName))) {
      issues.push({
        level: 'warning',
        code: 'var-totality',
        screenId: settingScreens[0].id,
        message: `הסימון "${varName}" נקבע רק בתנאי, ואין כלל שתופס את שאר המקרים — משיב שיחזור אחורה וישנה תשובה עלול להישאר עם הערך הישן`,
      });
    }
  }

  return issues;
}
