// Static validation of a SurveyConfig: graph integrity (cycles, dangling gotos,
// reachability), reference integrity (condition q/var refs), and the onSubmit
// totality invariant documented in src/questionnaire/placeholder.ts.
//
// Shared verbatim between the admin editor (live feedback) and the publish
// Netlify function (server-side gate) — esbuild bundles this file into both.

import type { Condition, Screen, SurveyConfig } from './types';

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
    | 'first-screen-showif';
  screenId?: string;
  message: string;
}

type Leaf = { q: string; op: string } | { var: string; op: string };

function collectLeaves(cond: Condition, out: Leaf[]): void {
  if ('all' in cond) cond.all.forEach((c) => collectLeaves(c, out));
  else if ('any' in cond) cond.any.forEach((c) => collectLeaves(c, out));
  else if ('not' in cond) collectLeaves(cond.not, out);
  else out.push(cond);
}

/** כל התנאים שמופיעים על מסך: showIf, next[].if, onSubmit[].if */
function screenConditions(screen: Screen): Condition[] {
  const out: Condition[] = [];
  if (screen.showIf) out.push(screen.showIf);
  for (const r of screen.next ?? []) if (r.if) out.push(r.if);
  for (const r of screen.onSubmit ?? []) if (r.if) out.push(r.if);
  return out;
}

/**
 * קשתות יציאה ממסך, לפי סמנטיקת findNext:
 * - כל יעד goto בכללי next (כללים אחרי כלל ללא-תנאי הם קוד מת ולא נספרים);
 * - אם אין כלל ללא-תנאי — נפילה קדימה: המסך הבא במערך, וכל עוד למסך הבא יש
 *   showIf (כלומר הוא עשוי להידלג) גם המסך שאחריו, עד המסך הראשון בלי showIf.
 * - ממסך end אין קשתות (הסשן מסתיים).
 */
function edgesFrom(screens: Screen[], idToIndex: Map<string, number>, index: number): number[] {
  const screen = screens[index];
  if (screen.type === 'end') return [];
  const targets: number[] = [];
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

/** האם קבוצת כללי onSubmit של משתנה במסך אחד היא "טוטאלית" — תמיד מציבה ערך. */
function assignsTotally(screen: Screen, varName: string): boolean {
  const rules = (screen.onSubmit ?? []).filter((r) => r.var === varName);
  if (rules.some((r) => !r.if)) return true;
  // זוג משלים: כלל עם תנאי X וכלל עם תנאי not(X)
  for (const a of rules) {
    for (const b of rules) {
      if (a === b || !a.if || !b.if) continue;
      if ('not' in b.if && JSON.stringify(b.if.not) === JSON.stringify(a.if)) return true;
    }
  }
  return false;
}

export function validateConfig(config: SurveyConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const screens = config.screens ?? [];

  if (screens.length === 0) {
    return [{ level: 'error', code: 'empty-config', message: 'השאלון ריק — אין מסכים כלל' }];
  }

  // --- זהויות ---
  const idToIndex = new Map<string, number>();
  screens.forEach((s, i) => {
    if (!s.id || !s.id.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-id',
        message: `למסך במיקום ${i + 1} אין מזהה (id)`,
      });
      return;
    }
    if (idToIndex.has(s.id)) {
      issues.push({
        level: 'error',
        code: 'duplicate-id',
        screenId: s.id,
        message: `המזהה "${s.id}" מופיע יותר מפעם אחת`,
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
      message: `המסך הראשון ("${screens[0].id}") לא יכול להיות מותנה (showIf) — חייב להיות מסך פתיחה שמוצג תמיד`,
    });
  }

  if (!screens.some((s) => s.type === 'end')) {
    issues.push({
      level: 'error',
      code: 'no-end-screen',
      message: 'אין בשאלון אף מסך סיום (end)',
    });
  }

  // --- שלמות הפניות ---
  const producedVars = new Set<string>(Object.keys(config.randomVars ?? {}));
  for (const s of screens) for (const r of s.onSubmit ?? []) producedVars.add(r.var);

  for (const s of screens) {
    for (const rule of s.next ?? []) {
      if (!idToIndex.has(rule.goto)) {
        issues.push({
          level: 'error',
          code: 'dangling-goto',
          screenId: s.id,
          message: `המסך "${s.id}" מנתב אל "${rule.goto}" שאינו קיים`,
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
          message: `תנאי במסך "${s.id}" מפנה לשאלה "${leaf.q}" שאינה קיימת`,
        });
      }
      if ('var' in leaf && !producedVars.has(leaf.var) && !leaf.var.startsWith('url_')) {
        issues.push({
          level: 'error',
          code: 'unknown-ref',
          screenId: s.id,
          message: `תנאי במסך "${s.id}" מפנה למשתנה "${leaf.var}" שאף מסך לא מציב (onSubmit) ואינו מוגרל (randomVars)`,
        });
      }
    }
  }

  // אם הזהויות שבורות אין טעם בבדיקות גרף — התוצאות יטעו
  if (issues.some((i) => i.code === 'duplicate-id' || i.code === 'empty-id')) return issues;

  // --- גרף: מעגלים ---
  // צביעה: 0=לבן 1=אפור(במסלול הנוכחי) 2=שחור. קשת אל אפור = מעגל.
  const color = new Array<number>(screens.length).fill(0);
  const stack: number[] = [];
  let cycleReported = false;

  function dfs(u: number): void {
    color[u] = 1;
    stack.push(u);
    for (const v of edgesFrom(screens, idToIndex, u)) {
      if (cycleReported) return;
      if (color[v] === 1) {
        const start = stack.indexOf(v);
        const path = [...stack.slice(start), v].map((i) => screens[i].id);
        issues.push({
          level: 'error',
          code: 'cycle',
          screenId: screens[v].id,
          message: `נמצא מעגל בניתוב: ${path.join(' ← ')} — משיב עלול להיתקע בלולאה אינסופית`,
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

  // --- גרף: נגישות מהמסך הראשון ---
  const reachable = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const v of edgesFrom(screens, idToIndex, u)) {
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
        message: `המסך "${s.id}" אינו נגיש מהמסך הראשון — אף משיב לא יגיע אליו`,
      });
    }
  });

  if (
    screens.some((s) => s.type === 'end') &&
    !screens.some((s, i) => s.type === 'end' && reachable.has(i))
  ) {
    issues.push({
      level: 'error',
      code: 'no-end-reachable',
      message: 'אף מסך סיום אינו נגיש מהמסך הראשון',
    });
  }

  // --- אינווריאנטת הטוטאליות של onSubmit ---
  // משתנה שמשמש בתנאים חייב להיות מוצב באופן טוטאלי לפחות במסך אחד, אחרת
  // חזרה אחורה ושינוי תשובה עלולים להשאיר ערך ישן (ראו placeholder.ts).
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
    if (settingScreens.length === 0) continue; // כבר דווח כ-unknown-ref
    if (!settingScreens.some((s) => assignsTotally(s, varName))) {
      issues.push({
        level: 'warning',
        code: 'var-totality',
        screenId: settingScreens[0].id,
        message: `המשתנה "${varName}" מוצב רק בתנאי, בלי כלל משלים (תנאי + not(תנאי)) או כלל ללא תנאי — חזרה אחורה ושינוי תשובה עלולים להשאיר ערך ישן`,
      });
    }
  }

  return issues;
}
