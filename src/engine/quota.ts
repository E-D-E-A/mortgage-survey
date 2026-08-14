// מכסות בזמן ריצה: מהגדרה (varMeta.quotas) למצב סשן, ומשם לניתוב.
//
// המנוע עצמו לא סופר דבר ולא פונה לרשת. מצב המכסות מגיע אליו כמשתני סשן
// רגילים — ‎quota_full_<mark>_<value> = true‎ — שנקבעים פעם אחת בכניסה
// (src/data/quota.ts) ומשם קבועים לכל אורך הסשן. שתי תוצאות לבחירה הזאת:
// המנוע נשאר טהור וניתן לבדיקה, ומשיב שהתחיל כשהמכסה הייתה פתוחה לא נזרק
// באמצע אם היא התמלאה תוך כדי.
//
// הספירה מקורבת בכוונה: שני משיבים יכולים לעבור את המשבצת האחרונה יחד. זה
// הסטנדרט בשאלונים, ועודף של אחד או שניים זול בהרבה מחסימת משיבים אמיתיים.

import type { Screen, SurveyConfig, SurveyContext, Vars } from './types';

/** ערך של סימון שיש עליו תקרה. */
export interface QuotaCell {
  mark: string;
  value: string;
  limit: number;
}

/** מספר המשיבים שסיימו, לפי סימון וערך: counts[mark][value]. */
export type QuotaCounts = Record<string, Record<string, number>>;

/**
 * שם משתנה הסשן שמסמן משבצת מלאה. השם מורכב ולא מקרי: הוא חייב להיות ייחודי
 * מול סימונים אמיתיים, והוא נשמר ב-payload של session_start — כך אפשר לדעת
 * בניתוח אילו משבצות היו סגורות כשהמשיב נכנס.
 */
export function quotaFullVar(mark: string, value: string | number | boolean): string {
  return `quota_full_${mark}_${value}`;
}

/** כל המשבצות שהוגדרה להן תקרה. סדר יציב — לפי סדר ההגדרה ב-varMeta. */
export function quotaCells(config: SurveyConfig): QuotaCell[] {
  return Object.entries(config.varMeta ?? {}).flatMap(([mark, meta]) =>
    Object.entries(meta.quotas ?? {}).map(([value, limit]) => ({ mark, value, limit })),
  );
}

/** משתני הסשן שנגזרים מהספירה — רק משבצות מלאות נרשמות, השאר פשוט חסרות. */
export function quotaVars(config: SurveyConfig, counts: QuotaCounts): Vars {
  const vars: Vars = {};
  for (const { mark, value, limit } of quotaCells(config)) {
    if ((counts[mark]?.[value] ?? 0) >= limit) vars[quotaFullVar(mark, value)] = true;
  }
  return vars;
}

/** מסך הסיום של "המכסה מלאה", או null — ואז אין לאן לנתב והמכסה לא נאכפת. */
export function quotaFullScreen(config: SurveyConfig): Screen | null {
  return config.screens.find((s) => s.type === 'end' && s.variant === 'quotafull') ?? null;
}

/**
 * האם המסך הזה הרגע העמיד את המשיב במשבצת מלאה.
 *
 * הבדיקה היא על ה-ctx שאחרי כללי ה-onSubmit (כך App.tsx ו-simulatePath קוראים
 * ל-findNext), ולכן היא שואלת שתי שאלות ביחד: המסך הזה הוא אחד מאלה שקובעים
 * את הערך, והמשיב אכן נושא אותו עכשיו. הרצת התנאים מחדש כאן הייתה מריצה אותם
 * על קונטקסט אחר מזה שבו הם הוכרעו — ותשובה אחרת מזו שהתקבלה בפועל.
 */
export function hitsFullQuota(screen: Screen, ctx: SurveyContext): boolean {
  return (screen.onSubmit ?? []).some(
    (rule) =>
      ctx.vars[rule.var] === rule.value &&
      ctx.vars[quotaFullVar(rule.var, rule.value)] === true,
  );
}
