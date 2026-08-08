// זהות השאלון — משותף לדפדפן ול-Netlify Functions (שתיהן מייבאות מכאן).
// ה-slug הוא המזהה היחיד של שאלון: הוא המפתח ב-DB, הוא הפרמטר בקצוות ה-API,
// והוא מה שמופיע בקישור הציבורי. לכן הוא מוגבל לתווים בטוחים ל-URL ולשאילתות
// PostgREST, והבדיקה חוזרת גם בשרת (אף פעם לא סומכים על הדפדפן).
// ⚠ אותה תבנית בדיוק היא ה-check על surveys.slug ב-supabase/schema.sql.

/** השאלון שמוגש בקישור הישן, בלי slug (‎/‎). נוצר במיגרציה מהמודל של שאלון יחיד. */
export const DEFAULT_SURVEY_SLUG = 'main';

export const SURVEY_SLUG_MAX = 40;

/** אותיות קטנות, ספרות ומקפים; לא מתחיל ולא מסתיים במקף. */
export const SURVEY_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SURVEY_SLUG_RE.test(value);
}

/**
 * הצעת slug משם בעברית. עברית לא נשארת ב-URL (תווים מקודדים בקישור שמודבק
 * לוואטסאפ נראים כמו זבל), ולכן שם עברי טהור מחזיר מחרוזת ריקה והעורך
 * מתבקש להקליד slug באנגלית.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SURVEY_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** הנתיב הציבורי של שאלון. שאלון ברירת המחדל נשאר על ‎/‎ — קישורים שכבר חולקו. */
export function surveyPath(slug: string): string {
  return slug === DEFAULT_SURVEY_SLUG ? '/' : `/s/${slug}`;
}

/**
 * ה-slug של השאלון שהדף הנוכחי מציג. כל נתיב שאינו ‎/s/<slug>‎ הוא השאלון
 * הראשי (כך קישורים שחולקו לפני ריבוי השאלונים ממשיכים לעבוד), ו-null מסמן
 * קישור פגום — עדיף להציג "לא נמצא" מאשר להגיש שאלון אחר בשקט.
 */
export function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/s\/([^/]*)\/?$/);
  if (!m) return DEFAULT_SURVEY_SLUG;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isValidSlug(slug) ? slug : null;
}
