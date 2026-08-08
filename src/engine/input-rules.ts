// Presentation and validation rules for a screen's inputs, on the respondent side.
// Extracted from components/inputs.tsx so the behaviour is unit-testable without a DOM.

import { shuffle } from './random';
import type { NumberScreen, Option, TextScreen } from './types';

/**
 * סדר האפשרויות להצגה.
 *
 * ⚠ ערבוב חל רק על אפשרויות התוכן. אפשרות בלעדית ("אף אחד מאלה", "הכול ברור לי")
 * היא אפשרות בריחה ולא אפשרות תוכן — אם היא נוחתת באמצע הרשימה היא נקראת
 * כאפשרות רגילה ומטה את שיעורי הבחירה. לכן היא מעוגנת תמיד בסוף.
 *
 * כשאין ערבוב הסדר של מחבר השאלון נשמר כמות שהוא, כולל אפשרות בלעדית
 * שהוצבה בכוונה בראש הרשימה (למשל "רק אני" ב-b_who).
 */
export function orderOptions(options: readonly Option[], shuffleOptions?: boolean): Option[] {
  if (!shuffleOptions) return [...options];
  return [...shuffle(options.filter((o) => !o.exclusive)), ...options.filter((o) => o.exclusive)];
}

type NumberRules = Pick<NumberScreen, 'min' | 'max' | 'integer'>;

/**
 * הודעת שגיאה לערך שהוקלד בשדה מספר, או null כשהערך תקין.
 * שדה ריק אינו שגיאה — עוד לא הוקלד דבר, ו"המשך" ממילא חסום.
 */
export function numberFieldError(rules: NumberRules, raw: string): string | null {
  if (raw.trim() === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 'יש להזין מספר';
  if (rules.integer && !Number.isInteger(num)) return 'יש להזין מספר שלם, בלי נקודה עשרונית';
  const { min, max } = rules;
  if (min !== undefined && max !== undefined && (num < min || num > max)) {
    return `הערך חייב להיות בין ${min} ל-${max}`;
  }
  if (min !== undefined && num < min) return `הערך חייב להיות ${min} או יותר`;
  if (max !== undefined && num > max) return `הערך חייב להיות ${max} או פחות`;
  return null;
}

/** ערך תקין לשליחה, או null כשהשדה ריק או שגוי. */
export function numberFieldValue(rules: NumberRules, raw: string): number | null {
  if (raw.trim() === '' || numberFieldError(rules, raw) !== null) return null;
  return Number(raw);
}

/** תקרת אורך ברירת מחדל לטקסט חופשי — נשלח פעמיים (אירוע answer + payload סופי). */
export const TEXT_MAX_LENGTH = 1000;

export function textLimit(screen: Pick<TextScreen, 'maxLength'>): number {
  // תקרה לא חוקית נופלת לברירת המחדל. maxLength={0} על השדה היה חוסם כל
  // הקלדה ומשאיר "המשך" חסום לנצח — המשיב תקוע. הוולידציה מתריעה בנפרד.
  const { maxLength } = screen;
  return Number.isInteger(maxLength) && (maxLength as number) > 0
    ? (maxLength as number)
    : TEXT_MAX_LENGTH;
}
