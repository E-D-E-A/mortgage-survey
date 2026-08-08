// כל מפתחות ה-sessionStorage של המשיב מקבלים את ה-slug של השאלון שהוא פתח.
// בלי זה, פתיחת שאלון שני באותה לשונית הייתה משחזרת את הסשן של הראשון:
// אותו session_id, אותו state שמור ואותו snapshot של קונפיג.
//
// שאלון ברירת המחדל שומר על המפתחות המקוריים בכוונה — משיבים שנמצאים
// באמצע השאלון הקיים ממשיכים בו גם אחרי העלאת הגרסה הזו.

import { DEFAULT_SURVEY_SLUG } from './surveys';

let scope = DEFAULT_SURVEY_SLUG;

/** נקרא פעם אחת בטעינת הדף, לפני כל קריאה ל-scopedKey. */
export function setSurveyScope(slug: string): void {
  scope = slug;
}

export function currentSurveyScope(): string {
  return scope;
}

export function scopedKey(base: string): string {
  return scope === DEFAULT_SURVEY_SLUG ? base : `${base}:${scope}`;
}
