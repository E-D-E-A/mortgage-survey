// שליפת מצב המכסות בכניסה לשאלון, והמרתו למשתני סשן.
//
// נקרא פעם אחת, לצד טעינת הקונפיג (AppShell), ורק לסשן חדש: משיב שכבר התחיל
// נושא את הדגלים שקיבל אז, ומכסה שהתמלאה תוך כדי לא זורקת אותו באמצע.
//
// ⚠ fail open בכל מסלול כשל — רשת, שרת, JSON פגום. משיב אמיתי לעולם לא נחסם
// בגלל תקלה אצלנו; המחיר הוא כמה משיבים מעבר למכסה, שזה בדיוק הכיוון הנכון
// לטעות בו.

import type { QuotaCounts } from '../engine/quota';
import { pinnedVersion } from './config';

const ENDPOINT = '/.netlify/functions/quota-get';

/**
 * הספירות מהשרת, או מפה ריקה. נקרא במקביל לטעינת הקונפיג ולא אחריה: הבקשה
 * אינה תלויה בו, וסידור טורי היה מוסיף סיבוב רשת שלם לפני המסך הראשון.
 * ההשוואה מול התקרות נעשית אצל הקורא, מול הקונפיג שהוצמד לסשן.
 */
export async function fetchQuotaCounts(slug: string): Promise<QuotaCounts> {
  // אותו גבול כמו באירועים: בפיתוח (vite dev) אין פונקציות, ואין מה לספור
  if (!import.meta.env.PROD) return {};
  // סשן קיים כבר נושא את הדגלים שלו — הבקשה כאן הייתה מעכבת כל רענון באמצע
  // השאלון בשביל תשובה שתיזרק
  if (pinnedVersion()) return {};

  try {
    const res = await fetch(`${ENDPOINT}?survey=${encodeURIComponent(slug)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { counts?: unknown };
    return isCounts(data.counts) ? data.counts : {};
  } catch {
    return {};
  }
}

function isCounts(value: unknown): value is QuotaCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (byValue) =>
      typeof byValue === 'object' &&
      byValue !== null &&
      !Array.isArray(byValue) &&
      Object.values(byValue).every((n) => typeof n === 'number'),
  );
}
