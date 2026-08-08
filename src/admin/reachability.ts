// לאן אפשר ליפול מכאן ברצף — הבסיס גם לקשתות בתרשים וגם לפאנל ההקשר.
//
// הבעיה שזה פותר: המנוע סורק קדימה עד המסך הראשון שעובר את תנאי התצוגה שלו,
// ותרגום נאיבי של זה לתצוגה מצייר קשת לכל מסך עד הראשון שאינו מותנה. בשאלון
// שבו 55 מתוך 70 המסכים מותנים יצאו מכך 1,494 קשתות דילוג — רובן המכריע
// מעברים שלא יכולים לקרות. שני כללים מכווצים את זה, ושניהם מדויקים ולא קירוב:
//
//   1. ראש ענף בלבד. מסכים עוקבים עם תנאי זהה נכשלים או מצליחים יחד — בתוך
//      סריקה אחת ההקשר קבוע — ולכן רק הראשון בהם יכול להיות יעד נחיתה.
//   2. סתירה והבטחה. אם תנאי המקור מחייב segment=A ותנאי היעד מחייב segment=B,
//      המעבר אינו אפשרי; ואם תנאי היעד כלול בתנאי המקור, הנחיתה ודאית והסריקה
//      נעצרת שם.
//   3. השתלטות. יעד שתנאו מחייב את תנאו של יעד קודם לעולם לא ייבחר לפניו.
//
// ⚠ הגיזום חייב להיות שמרני: להסתיר מעבר אמיתי גרוע בהרבה מלצייר יותר מדי.
// לכן כל מה שאינו ודאי — אופרטור שאינו eq/in, תנאי מקורב — פשוט אינו נגזם.

import type { Condition, Op, Screen } from '../engine/types';

type Leaf = { q?: string; var?: string; op: Op; value?: unknown };

/** פירוק ל"כל התנאים האלה חייבים להתקיים". any/not אינם מתפרקים. */
export function conjuncts(cond: Condition | undefined): Condition[] {
  if (!cond) return [];
  if ('all' in cond) return cond.all.flatMap(conjuncts);
  return [cond];
}

/** מרחב שמות נפרד לשאלות ולמשתנים — s_status ו-segment לא מתנגשים. */
function refOf(cond: Condition): string | null {
  if ('q' in cond) return `q:${cond.q}`;
  if ('var' in cond) return `var:${cond.var}`;
  return null;
}

/** קבוצת הערכים שהתנאי מתיר, או null כשאי אפשר לדעת בוודאות. */
function allowedValues(cond: Condition): Set<string> | null {
  const leaf = cond as Leaf;
  if (leaf.op === 'eq') return new Set([String(leaf.value)]);
  if (leaf.op === 'in') return new Set((Array.isArray(leaf.value) ? leaf.value : []).map(String));
  return null;
}

/** שני התנאים לא יכולים להתקיים יחד: אותו נושא, וקבוצות ערכים זרות. */
export function excludes(a: Condition[], b: Condition[]): boolean {
  for (const x of a) {
    const ref = refOf(x);
    if (!ref) continue;
    const xs = allowedValues(x);
    if (!xs) continue;
    for (const y of b) {
      if (refOf(y) !== ref) continue;
      const ys = allowedValues(y);
      if (!ys) continue;
      if (![...ys].some((v) => xs.has(v))) return true;
    }
  }
  return false;
}

/** תנאי המקור כבר מכיל את כל מה שהיעד דורש — הנחיתה ודאית. */
export function guarantees(a: Condition[], b: Condition[]): boolean {
  if (b.length === 0) return true;
  const have = new Set(a.map((c) => JSON.stringify(c)));
  return b.every((c) => have.has(JSON.stringify(c)));
}

/**
 * מה מתנאי התצוגה של המקור עדיין נכון ברגע הסריקה קדימה.
 *
 * הסריקה רצה *אחרי* ה-onSubmit של המקור, ולכן תנאי שנשען על משתנה שהמקור
 * עצמו מציב, או על התשובה למקור עצמו, כבר אינו בהכרח מה שהיה כשהמסך הוצג.
 * בשאלון הנוכחי זה לא קורה, אבל בלי הסינון הזה קונפיג עתידי היה מקבל קשתות
 * שגויות בשקט.
 */
function usableContext(source: Screen): Condition[] {
  const written = new Set((source.onSubmit ?? []).map((r) => r.var));
  return conjuncts(source.showIf).filter((c) => {
    if ('var' in c) return !written.has(c.var);
    if ('q' in c) return c.q !== source.id;
    return true;
  });
}

/** תנאי ניתוב ללא תנאי נתפס תמיד — אין נפילה קדימה בכלל. */
function alwaysJumps(screen: Screen): boolean {
  return (screen.next ?? []).some((r) => !r.if);
}

/**
 * המסכים שהמנוע יכול לנחות עליהם כשהוא ממשיך מ-`index` ברצף, לפי הסדר.
 * הראשון הוא ההמשך הרגיל; השאר הם החלופות אם הוא מדולג.
 */
export function fallThroughTargets(screens: Screen[], index: number): Screen[] {
  const source = screens[index];
  if (!source || source.type === 'end' || alwaysJumps(source)) return [];

  const context = usableContext(source);
  const out: Screen[] = [];
  let j = index + 1;
  while (j < screens.length) {
    const target = screens[j];
    if (!target.showIf) {
      out.push(target);
      break; // מוצג תמיד — אי אפשר להמשיך מעבר לו
    }
    const targetConjuncts = conjuncts(target.showIf);
    // יעד שתנאו מחייב את תנאו של יעד קודם לא יכול להיות הנחיתה: אם תנאו
    // מתקיים, אז גם של הקודם — והסריקה הייתה נעצרת שם. זה מה שמכווץ "כל
    // מסכי מסלול A" ליעד אחד: ראש המסלול.
    const dominated = out.some((earlier) => guarantees(targetConjuncts, conjuncts(earlier.showIf)));
    if (!dominated && !excludes(context, targetConjuncts)) {
      out.push(target);
      if (guarantees(context, targetConjuncts)) break;
    }
    // דילוג על יתר הענף: תנאי זהה נכשל או מצליח יחד עם ראשו
    const key = JSON.stringify(target.showIf);
    while (j + 1 < screens.length && screens[j + 1].showIf && JSON.stringify(screens[j + 1].showIf) === key) {
      j++;
    }
    j++;
  }
  return out;
}

/**
 * מי יכול ליפול לכאן ברצף — מוגדר כהיפוך של fallThroughTargets ולא כהליכה
 * אחורה נפרדת, כדי שהתרשים והפאנל לא יוכלו לספר שני סיפורים שונים.
 * מוחזר מהקרוב לרחוק: המקור הסמוך הוא הסיפור הרגיל, והרחוקים הם החריגים.
 */
export function fallThroughSources(screens: Screen[], index: number): Screen[] {
  const id = screens[index]?.id;
  if (!id) return [];
  return screens
    .slice(0, index)
    .filter((_, j) => fallThroughTargets(screens, j).some((t) => t.id === id))
    .reverse();
}
