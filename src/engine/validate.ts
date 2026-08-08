// Static validation of a SurveyConfig: graph integrity (cycles, dangling gotos,
// reachability), reference integrity (condition q/var refs), and the onSubmit
// totality invariant documented in src/questionnaire/placeholder.ts.
//
// Shared verbatim between the admin editor (live feedback) and the publish
// Netlify function (server-side gate) — esbuild bundles this file into both.

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
    | 'var-order';
  screenId?: string;
  message: string;
}

type Leaf =
  | { q: string; op: string; value?: unknown }
  | { var: string; op: string; value?: unknown };

/** אופרטורים שערכם אמור להיות מזהה אפשרות של המסך המופנה. */
const OPTION_VALUE_OPS = new Set(['eq', 'ne', 'in', 'includes', 'includesAny']);

/** אפשרויות הבחירה של המסך, או null למסך שאין לו אפשרויות. */
function optionsOf(screen: Screen): Option[] | null {
  return screen.type === 'single' || screen.type === 'multi' ? screen.options : null;
}

/** הכותרת שהמשיב רואה, והשם של השדה שמחזיק אותה (להודעה בעברית). */
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
 * שלמות רשימת פריטים (אפשרויות במסך בחירה, שורות במטריצה): רשימה לא ריקה,
 * מזהים קיימים וייחודיים, ותוויות לא ריקות. כל אחד מאלה שובר את המסך למשיב
 * או את הקידוד בניתוח.
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
        message: `ל${kind} ${i + 1} במסך "${screenId}" אין מזהה (id) — התשובה תישמר בלי משמעות`,
      });
    } else if (seen.has(item.id)) {
      issues.push({
        level: 'error',
        code: 'duplicate-choice-id',
        screenId,
        message: `המזהה "${item.id}" חוזר ביותר מ${kind} אחת במסך "${screenId}" — אי אפשר להבחין ביניהן בניתוח`,
      });
    } else {
      seen.add(item.id);
    }
    if (typeof item.label !== 'string' || !item.label.trim()) {
      issues.push({
        level: 'error',
        code: 'empty-text',
        screenId,
        message: `ל${kind} ${i + 1} במסך "${screenId}" אין טקסט — המשיב יראה שורה ריקה`,
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

/**
 * ערך בתנאי שאמור להיות מזהה אפשרות — ואינו אחת מהאפשרויות של המסך המופנה.
 * זה מה שקורה כששמו של id של אפשרות משתנה או שהאפשרות נמחקת: התנאי נשאר
 * תקין תחבירית, והענף פשוט מת בלי שום סימן חיצוני.
 *
 * ⚠ רק ערכים מחרוזתיים נבדקים. השוואה מול מספר (למשל על מסך שהיה בעבר מסוג
 * אחר) עשויה להיות מכוונת, ואזהרת שווא כאן גרועה יותר מהחמצה.
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
  if (targetIndex === undefined) return; // כבר דווח כ-unknown-ref
  const options = optionsOf(screens[targetIndex]);
  if (!options) return;

  const ids = new Set(options.map((o) => o.id));
  const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  for (const value of values) {
    if (typeof value !== 'string' || ids.has(value)) continue;
    // ne הפוך: ערך שלא קיים הופך את התנאי לאמת תמידית ולא לענף מת
    const effect = leaf.op === 'ne' ? 'התנאי יתקיים תמיד' : 'הענף לעולם לא יופעל';
    issues.push({
      level: 'error',
      code: 'unknown-option',
      screenId,
      message: `תנאי במסך "${screenId}" בודק את "${leaf.q}" מול "${value}", שאינו אחת מהאפשרויות של אותו מסך — ${effect}`,
    });
  }
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

  // --- שלמות תוכן המסך ---
  // עריכה שנראית תמימה (שינוי מזהה אפשרות, מחיקת האפשרות האחרונה, סולם הפוך)
  // יכולה להשאיר את המשיב מול מסך ריק או תקוע בלי דרך להמשיך ובלי דרך לחזור.
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
        message: `למסך ההסכמה "${s.id}" חסר טקסט באחד מכפתורי ההסכמה`,
      });
    }

    const options = optionsOf(s);
    if (options) {
      checkChoiceList(
        s.id,
        'אפשרות',
        options,
        `למסך "${s.id}" אין אף אפשרות לבחירה — "המשך" יישאר חסום והמשיב ייתקע`,
        issues,
      );
    }

    if (s.type === 'multi' && s.maxSelections !== undefined) {
      if (!Number.isInteger(s.maxSelections) || s.maxSelections < 1) {
        issues.push({
          level: 'error',
          code: 'bad-max-selections',
          screenId: s.id,
          message: `מכסת הבחירות במסך "${s.id}" היא ${s.maxSelections} — חייב מספר שלם מ-1 ומעלה (0 או ערך שלילי אינם "בלי הגבלה")`,
        });
      } else if (s.maxSelections >= s.options.length) {
        issues.push({
          level: 'warning',
          code: 'bad-max-selections',
          screenId: s.id,
          message: `מכסת הבחירות במסך "${s.id}" (${s.maxSelections}) אינה קטנה ממספר האפשרויות — היא לא מגבילה דבר`,
        });
      }
    }

    if (s.type === 'text' && s.maxLength !== undefined) {
      if (!Number.isInteger(s.maxLength) || s.maxLength < 1) {
        issues.push({
          level: 'error',
          code: 'bad-text-limit',
          screenId: s.id,
          message: `תקרת התווים במסך "${s.id}" היא ${s.maxLength} — חייב מספר שלם מ-1 ומעלה (0 היה חוסם כל הקלדה)`,
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
          message: `הסולם במטריצה "${s.id}" הפוך (${scaleMin} עד ${scaleMax}) — לא ייווצר אף כפתור והמשיב ייתקע`,
        });
      } else if (scaleMin === scaleMax) {
        issues.push({
          level: 'warning',
          code: 'scale-range',
          screenId: s.id,
          message: `לסולם במטריצה "${s.id}" יש ערך אחד בלבד (${scaleMin}) — אין כאן מה למדוד`,
        });
      }
    }
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
      if ('q' in leaf) checkOptionValues(s.id, leaf, screens, idToIndex, issues);
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
          // מזהים במרכאות כדי שהקונסולה תוכל להחליף אותם בשמות המסכים
          message: `נמצא מעגל בניתוב: ${path.map((id) => `"${id}"`).join(' ← ')} — משיב עלול להיתקע בלולאה אינסופית`,
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

  // --- סדר: משתנה שנבדק לפני שהוא מוצב ---
  // גרירה אחת בעכבר יכולה להקדים מסך מותנה לפני המסך שמייצר את המשתנה שלו.
  // התוצאה שקטה לחלוטין: המסך פשוט לא יוצג לאף משיב, כי בזמן הבדיקה למשתנה
  // עדיין אין ערך.
  //
  // showIf נבדק *לפני* שהמסך נשלח ולכן דורש יצרן במסך קודם ממש; כללי next
  // ו-onSubmit נבדקים אחרי שכללי ה-onSubmit של המסך עצמו כבר רצו (App.tsx
  // ממקם אותם על אותו ctx), ולכן המסך עצמו נחשב יצרן לגיטימי עבורם.
  //
  // אזהרה ולא שגיאה: כללי goto יכולים לשנות את סדר ההגעה בפועל, וסדר המערך
  // הוא רק ברירת המחדל.
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
        if (!producers || producers.length === 0) continue; // כבר דווח כ-unknown-ref
        if (producers.some((p) => p <= latestProducer)) continue;
        reported.add(leaf.var);
        issues.push({
          level: 'warning',
          code: 'var-order',
          screenId: s.id,
          message: `המסך "${s.id}" נשען על המשתנה "${leaf.var}", אבל כל המסכים שמציבים אותו באים אחריו בזרימה — התנאי ייבדק לפני שיש למשתנה ערך`,
        });
      }
    }
  });

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
