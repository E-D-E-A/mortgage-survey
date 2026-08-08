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
