// לקוח Supabase Auth לקונסולת הניהול (נטען רק ב-chunk של /admin).
// המפתח כאן הוא ה-anon key — מפתח ציבורי בהגדרתו. הוא לא מקנה שום גישה
// לנתונים: RLS חוסם את anon לגמרי (אפס policies), והוא משמש אך ורק
// לדיבור עם Supabase Auth. האכיפה (דומיין first-edea.com) בשרת בלבד.

import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const authConfigured = Boolean(URL_ && KEY);

// כתובת החזרה מגוגל — חייבת להצביע על /admin, אחרת ההפניה נוחתת על השאלון
// עצמו שבו הקונסולה כלל לא נטענת. חייבת להיות ברשימת ה-Redirect URLs
// בדשבורד Supabase, אחרת supabase מתעלם ממנה ומפנה ל-Site URL.
export const adminRedirectUrl =
  typeof window === 'undefined' ? '' : `${window.location.origin}/admin`;

// detectSessionInUrl: supabase-js קולט לבד את הטוקנים מה-URL בחזרה מגוגל
// ומשדר SIGNED_IN — אין צורך לפרסר את הכתובת ידנית.
export const supabase = createClient(URL_ ?? 'http://invalid.local', KEY ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const ALLOWED_DOMAIN = 'first-edea.com';

/** מפנה לגוגל. hd מסנן מראש את בוחר החשבונות — רמז UX, לא אכיפה. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: adminRedirectUrl,
      queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/** ה-access token של הסשן הנוכחי, לשליחה כ-Bearer לפונקציות. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
