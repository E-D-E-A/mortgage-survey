// אימות אדמין מול Supabase Auth. הלקוח שולח Authorization: Bearer <access_token>
// שקיבל מ-supabase-js אחרי כניסה עם Google; כאן מאמתים אותו מול Supabase
// ואוכפים את הדומיין.
//
// זו נקודת האכיפה היחידה. חשוב: ה-anon key ציבורי, ולכן כל אחד באינטרנט יכול
// להשלים כניסה עם Google מול הפרויקט — ההגבלה לדומיין first-edea.com נאכפת
// כאן ולא בדפדפן. פרמטר hd בכפתור, מסך הסכמה Internal בגוגל וה-hook
// before-user-created הם שכבות נוספות, לא תחליף לבדיקה הזו.

const ALLOWED_DOMAIN = 'first-edea.com';

interface SupabaseUser {
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
}

export interface AdminSession {
  email: string;
}

/**
 * מאמת את ה-Bearer token ומחזיר את זהות העורך, או Response עם השגיאה:
 * 401 — טוקן חסר/פגום/פג. 403 — משתמש תקין אבל לא מהדומיין המורשה.
 */
export async function requireAdmin(req: Request): Promise<AdminSession | Response> {
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return new Response('server not configured', { status: 503 });

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 8192) return new Response('unauthorized', { status: 401 });

  const res = await fetch(`${supaUrl}/auth/v1/user`, {
    headers: { apikey: supaKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return new Response('unauthorized', { status: 401 });

  const user = (await res.json()) as SupabaseUser;
  const email = (user.email ?? '').toLowerCase();

  // מייל מאומת בלבד — חוסם חשבון שנרשם עם כתובת בדומיין בלי לאמת אותה
  if (!(user.email_confirmed_at ?? user.confirmed_at)) {
    return new Response('forbidden: email not confirmed', { status: 403 });
  }
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return new Response(`forbidden: ${ALLOWED_DOMAIN} accounts only`, { status: 403 });
  }

  // הגנה לעומק: זהות Google בלבד. מכוון לבדוק את providers (מערך) ולא את
  // provider (יחיד) — בחשבון שנוצר קודם עם סיסמה וקושר לגוגל, provider
  // נשאר 'email' בעוד providers מכיל את שניהם. אם השדה חסר — לא חוסמים,
  // האכיפה האמיתית היא הדומיין למעלה + כיבוי ספק ה-Email בדשבורד.
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.length > 0 && !providers.includes('google')) {
    return new Response('forbidden: google sign-in required', { status: 403 });
  }

  return { email };
}
