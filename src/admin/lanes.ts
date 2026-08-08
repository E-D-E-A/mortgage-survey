// ענף = רצף מסכים עוקבים שחולקים תנאי תצוגה זהה. זו היחידה שהאדמין חושב
// עליה כ"מסלול" ("כל מסכי A"), וזו גם יחידת העריכה: תנאי אחד לכל הרצף.
//
// בלי זה, שינוי תנאי מסלול הוא 19 עריכות זהות, וכל שכחה מפצלת את הענף לשניים
// בלי שום סימן — גם בתרשים וגם בזרימה בפועל.

import type { Screen } from '../engine/types';

/**
 * כל המסכים שחולקים עם `id` את אותו תנאי תצוגה ברצף רציף.
 * מסך בלי תנאי תצוגה עומד לבדו — אין לו ענף.
 */
export function laneMembers(screens: Screen[], id: string): string[] {
  const index = screens.findIndex((s) => s.id === id);
  if (index < 0) return [];
  const key = screens[index].showIf ? JSON.stringify(screens[index].showIf) : null;
  if (key === null) return [id];

  let start = index;
  while (start > 0 && screens[start - 1].showIf && JSON.stringify(screens[start - 1].showIf) === key) {
    start--;
  }
  let end = index;
  while (
    end + 1 < screens.length &&
    screens[end + 1].showIf &&
    JSON.stringify(screens[end + 1].showIf) === key
  ) {
    end++;
  }
  return screens.slice(start, end + 1).map((s) => s.id);
}
