// רתמת בדיקה לקונסולת הניהול, בלי Google ובלי Supabase.
//
// למה זה קיים: ‎/admin‎ מוגן ב-Google OAuth מול first-edea.com, ואי אפשר לעבור
// אותו מדפדפן אוטומטי. הרתמה מזריקה סשן מזויף ל-localStorage (supabase-js קורא
// אותו ומשדר INITIAL_SESSION בלי שום קריאת רשת), חוסמת כל בקשה ל-Supabase,
// ומחליפה את שלוש פונקציות ה-Netlify בסטאבים. כך ‎npm run dev‎ לבדו מספיק,
// ושום דבר לא נכתב ל-DB האמיתי.
//
// ⚠ הרתמה הזאת אבדה כבר פעם אחת (היא ישבה ב-scratchpad של סשן ולא בריפו).
// לכן היא כאן. ראו qa/README.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * מזהה הפרויקט ב-Supabase — תת-הדומיין של VITE_SUPABASE_URL. הוא מרכיב את שם
 * מפתח האחסון שבו supabase-js מחפש את הסשן, ולכן חייב להתאים לסביבה הרצה.
 * (אינו סוד: הוא נצרב ממילא לתוך הבאנדל של הלקוח.)
 */
function projectRef() {
  try {
    const env = readFileSync(join(here, '..', '.env'), 'utf8');
    const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim();
    const ref = url?.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1];
    if (ref) return ref;
  } catch {
    /* אין .env מקומי — נשארים עם ברירת המחדל */
  }
  return 'localhost';
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** צריך רק *להיראות* כמו JWT (שלושה חלקי base64url) — איש לא מאמת אותו כאן. */
const FAKE_JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'qa', exp: 4102444800 })}.sig`;

const SESSION = {
  access_token: FAKE_JWT,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800,
  refresh_token: 'fake-refresh',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'qa@first-edea.com',
    app_metadata: { provider: 'google' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
};

/** שלושה שאלונים שמכסים את שלושת מצבי הכרטיס: פעיל, טרם פורסם, בארכיון. */
const SURVEYS = [
  {
    slug: 'mortgage-personas',
    name: 'שאלון מחקר — משכנתאות בישראל',
    created_at: '2026-07-01T09:00:00Z',
    created_by: 'eden@first-edea.com',
    archived_at: null,
    has_draft: true,
    draft_updated_at: '2026-08-08T14:20:00Z',
    draft_updated_by: 'eden@first-edea.com',
    versions: 3,
    latest_version: 'v1.1',
    latest_published_at: '2026-08-07T11:00:00Z',
  },
  {
    slug: 'pilot-round-2',
    name: 'פיילוט סבב שני',
    created_at: '2026-06-11T09:00:00Z',
    created_by: 'eden@first-edea.com',
    archived_at: null,
    has_draft: false,
    draft_updated_at: null,
    draft_updated_by: null,
    versions: 0,
    latest_version: null,
    latest_published_at: null,
  },
  {
    slug: 'old-screener',
    name: 'סינון ישן (ארכיון)',
    created_at: '2026-02-02T09:00:00Z',
    created_by: 'eden@first-edea.com',
    archived_at: '2026-05-01T09:00:00Z',
    has_draft: false,
    draft_updated_at: null,
    draft_updated_by: null,
    versions: 2,
    latest_version: 'v0.9',
    latest_published_at: '2026-04-20T09:00:00Z',
  },
];

export const BASE_URL = process.env.QA_BASE_URL ?? 'http://localhost:5199';

/**
 * שולף את השאלון האמיתי (survey-v1.ts) מגרף המודולים של vite, כדי שהעורך
 * ייבדק על 38 מסכים אמיתיים ולא על דוגמה בת שלושה מסכים.
 */
export async function loadQuestionnaire(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const config = await page.evaluate(async () => {
    const m = await import('/src/questionnaire/survey-v1.ts');
    return JSON.parse(JSON.stringify(m.questionnaire));
  });
  await ctx.close();
  return config;
}

/** מתקין את הסשן המזויף ואת הסטאבים על ה-context. חייב לרוץ לפני ה-goto הראשון. */
export async function installHarness(ctx, config) {
  await ctx.addInitScript(
    ([ref, session]) => {
      try {
        localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
      } catch {
        /* אחסון חסום — הבדיקה תיפול על מסך הכניסה, וזה יהיה גלוי */
      }
    },
    [projectRef(), SESSION],
  );

  // רשת החוצה נחסמת מפורשות — הרתמה לא אמורה לגעת בפרויקט האמיתי לעולם
  await ctx.route('**://*.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await ctx.route('**/.netlify/functions/admin-surveys*', (route) =>
    route.fulfill(json({ surveys: SURVEYS })),
  );

  await ctx.route('**/.netlify/functions/admin-draft*', (route) =>
    route.fulfill(
      route.request().method() === 'PUT'
        ? json({ updated_at: new Date().toISOString() })
        : json({ config, updated_at: '2026-08-08T14:20:00Z' }),
    ),
  );

  await ctx.route('**/.netlify/functions/admin-publish*', (route) =>
    route.fulfill(json({ version: 'v1.2', warnings: [] })),
  );
}

/** מכשירים שאנחנו בודקים עליהם. 320 הוא ה-iPhone SE — הרוחב הקטן שעוד בשימוש. */
export const VIEWPORTS = [
  { tag: '320', width: 320, height: 568 },
  { tag: '390', width: 390, height: 844 },
  { tag: '768', width: 768, height: 1024 },
  { tag: '1440', width: 1440, height: 900 },
];

export function contextOptions({ width, height }) {
  return {
    viewport: { width, height },
    // מתחת ל-900 נכנסת פריסת המובייל של הקונסולה, ולשם צריך pointer: coarse
    hasTouch: width < 900,
    isMobile: width < 700,
    locale: 'he-IL',
  };
}
