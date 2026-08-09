// עריכות מבניות על רשימת המסכים, כפונקציות טהורות: היכן מסך חדש נכנס ומה
// בדיוק מועתק בשכפול. שתיהן נראות טריוויאליות ושתיהן היו מקור לבאגים שקטים
// (דוח QA 2026-08-08, A6 ו-A11), ולכן הן יושבות כאן ולא בתוך רכיב.

import type { Screen } from '../engine/types';

/** מזהה פנוי על בסיס `base`, בלי להתנגש בקיימים. */
export function uniqueId(base: string, screens: Screen[]): string {
  const taken = new Set(screens.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * האם שתי גרסאות של הקונפיג חולקות בדיוק את אותו מבנה — אותם מפתחות בכל רמה,
 * אותם אורכי מערך — ונבדלות רק בערך של עלה.
 *
 * זה מה שמבדיל הקלדה בשדה (אותו מבנה, תו נוסף) מפעולה מבנית (הוספת אפשרות,
 * מחיקת שורה, הסרת תנאי). היסטוריית ה-undo מאחדת עריכות צפופות כדי שהקלדה
 * לא תייצר צעד undo לכל תו — אבל בלי הבחנה הזאת גם שתי לחיצות כפתור בתוך
 * שנייה התאחדו, וביטול אחד ביטל כמה פעולות נפרדות שהעורך ביצע בכוונה.
 */
export function sameShape(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    if (keys.length !== Object.keys(b as object).length) return false;
    return keys.every(
      (k) =>
        k in (b as object) &&
        sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  // עלה: גם החלפת טיפוס (מספר ↔ מחרוזת) היא שינוי מבני ולא הקלדה
  return typeof a === typeof b;
}

/**
 * הקוד הפנוי הבא לאפשרות או לשורת מטריצה.
 *
 * ספירה לפי אורך הרשימה מייצרת קוד כפול ברגע שנמחקה שורה באמצע: opt_1..opt_3,
 * מוחקים את opt_1, ו"הוספת אפשרות" מייצרת opt_3 שכבר קיים. הוולידציה אמנם
 * מתריעה, אבל השגיאה נולדת מלחיצה על כפתור תקין — ובניתוח שתי שורות עם אותו
 * קוד אינן ניתנות להפרדה.
 */
export function nextChoiceId(prefix: string, taken: readonly { id: string }[]): string {
  const used = new Set(taken.map((t) => t.id));
  for (let n = taken.length + 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * היכן להכניס מסך חדש.
 *
 * הוספה לסוף המערך נחתה אחרי מסכי הסיום: כל הוספה ייצרה מיד אזהרת "אינו נגיש
 * מהמסך הראשון" וחייבה גרירה ידנית לאורך 70 פריטים. במקום זה — אחרי המסך
 * שנבחר כרגע, ואם אין נבחר (או שהנבחר הוא מסך סיום) לפני מסך הסיום הראשון.
 */
export function insertScreen(
  screens: Screen[],
  added: Screen,
  selectedId: string | null,
): Screen[] {
  // מסך סיום חדש נכנס לסוף: הכנסתו לפני מסך סיום קיים הייתה חוטפת את
  // הנפילה-קדימה של המסך שלפניו ומשנה את סיום השאלון בלי שהעורך ביקש
  if (added.type === 'end') return [...screens, added];

  const selected = selectedId ? screens.findIndex((s) => s.id === selectedId) : -1;
  const firstEnd = screens.findIndex((s) => s.type === 'end');
  const at =
    selected >= 0 && screens[selected].type !== 'end'
      ? selected + 1
      : firstEnd >= 0
        ? firstEnd
        : screens.length;

  const next = [...screens];
  next.splice(at, 0, added);
  return next;
}

/**
 * שכפול מסך — מעתיק את *התוכן* בלבד, מיד אחרי המקור.
 *
 * deep-copy מלא נתן שני מסכים שמציבים את אותו משתנה או מנתבים לאותו יעד; זה
 * קל מאוד ליצור בטעות (כפתור השכפול יושב ליד המחיקה בסרגל הריחוף) וקשה מאוד
 * לשים לב אליו. showIf כן נשמר — הוא חלק מ"איפה המסך הזה חי", והעותק אמור
 * לשבת באותו מקטע כמו המקור.
 */
export function duplicateScreen(screens: Screen[], id: string): Screen[] {
  const index = screens.findIndex((s) => s.id === id);
  if (index < 0) return screens;

  const { next: _next, onSubmit: _onSubmit, ...content } = screens[index];
  const copy = structuredClone(content) as Screen;
  copy.id = uniqueId(`${id}_2`, screens);

  const out = [...screens];
  out.splice(index + 1, 0, copy);
  return out;
}
