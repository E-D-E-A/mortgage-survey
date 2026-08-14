// Applies supabase/schema.sql to the local Postgres from `npx supabase start`.
// Usage: npm run db:schema
// The same semantics as pasting it into the cloud SQL Editor — the file is
// idempotent and safe to re-run.
// A guard: any non-local host is refused — this tool exists so that development
// never touches the cloud by accident.
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
