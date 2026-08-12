// תשתית בדיקות ה-DB: חיבור מקומי-בלבד והחלת הסכמה על הסטאק של `supabase start`.
// ההגנה כאן קשיחה בכוונה — הבדיקות מסרבות לכל מארח שאינו מקומי, כדי שריצה עם
// ‎.env‎ שמצביע על הענן לא תוכל לגעת בנתוני אמת לעולם.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

/** הקבוצה רצה רק בהפעלה מפורשת: DB_TESTS=1 (ו-`npx supabase start` פעיל) */
export const dbTestsEnabled = process.env.DB_TESTS === '1';

/** ברירת המחדל של הסטאק המקומי (פורט ה-DB מ-supabase/config.toml) */
export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export function connectLocal(): Sql {
  const url = process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL;
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`DB tests refuse a non-local database host: ${host}`);
  }
  return postgres(url, { onnotice: () => {} });
}

export async function applySchema(sql: Sql): Promise<void> {
  const ddl = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  // vitest מריץ קבצי בדיקה במקביל מול אותו DB; advisory lock מסדר את ה-DDL
  // (drop/create חוזרים) כך ששני קבצים לא יחילו את הסכמה בו-זמנית.
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(732912)`;
    await tx.unsafe(ddl);
  });
}

// ─── Auth מקומי: משתמשים וטוקנים אמיתיים ל-requireAdmin ─────────────────────
// המפתחות האלה הם מפתחות הדמו הפומביים של `supabase start` — זהים בכל התקנה
// מקומית, לא סוד. אין להם שום תוקף מול הענן.
export const LOCAL_API_URL = 'http://127.0.0.1:54321';
export const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
export const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TEST_PASSWORD = 'local-test-password-1';

/**
 * יוצר משתמש דרך ה-admin API המקומי, מאומת-מייל ועם providers=['google'] —
 * כמו משתמש אמיתי של הקונסולה (requireAdmin דורש זהות Google). כניסה בבדיקות
 * נעשית עם סיסמה; app_metadata נשאר כפי שהוגדר כאן.
 */
export async function createAdminUser(email: string): Promise<void> {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { provider: 'google', providers: ['google'] },
    }),
  });
  // 422 = כבר קיים מריצה קודמת — תקין
  if (!res.ok && res.status !== 422) {
    throw new Error(`createAdminUser(${email}) failed: ${res.status} ${await res.text()}`);
  }
}

export async function signIn(email: string): Promise<string> {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: LOCAL_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!res.ok) throw new Error(`signIn(${email}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}
