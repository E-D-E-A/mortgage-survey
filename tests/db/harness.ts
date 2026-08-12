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
  await sql.unsafe(ddl);
}
