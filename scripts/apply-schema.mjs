// מחיל את supabase/schema.sql על ה-Postgres המקומי של `npx supabase start`.
// שימוש: npm run db:schema
// אותה סמנטיקה כמו הדבקה ב-SQL Editor בענן — הקובץ idempotent וניתן להרצה חוזרת.
// הגנה: מסרבים למארח שאינו מקומי — הכלי קיים כדי שפיתוח לא ייגע בענן בטעות.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`refusing non-local database host: ${host}`);
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });
try {
  const ddl = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await sql.unsafe(ddl);
  console.log('schema.sql applied to', host);
} finally {
  await sql.end();
}
