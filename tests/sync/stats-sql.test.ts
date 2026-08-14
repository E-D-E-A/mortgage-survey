// שכבת ה-SQL של הסטטיסטיקות חיה בשני עולמות שאינם חולקים טיפוס: schema.sql
// וקריאות ה-rpc בפונקציות ה-Netlify. סחיפה ביניהם נכשלת רק בפרודקשן — ולכן
// הבדיקות כאן, באותה רוח כמו src/data/events.test.ts. רצות תמיד, בלי DB.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const schema = () => read('supabase/schema.sql');

/**
 * כל קריאות ה-rpc בכל פונקציות ה-Netlify — גם URL מפורש (rest/v1/rpc/<name>)
 * וגם דרך עזר rpc(env, '<name>', ...), הצורה שבה admin-stats קורא.
 */
function rpcCallsInFunctions(): string[] {
  const dir = new URL('netlify/functions/', root);
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.mts')) continue;
    const src = read(`netlify/functions/${file}`);
    for (const m of src.matchAll(/rest\/v1\/rpc\/([a-z_]+)/g)) names.add(m[1]);
    for (const m of src.matchAll(/rpc\([^,]+,\s*'([a-z_]+)'/g)) names.add(m[1]);
  }
  return [...names];
}

describe('stats SQL stays in sync with the functions layer', () => {
  it('every rpc the functions call exists in schema.sql', () => {
    const sql = schema();
    for (const fn of rpcCallsInFunctions()) {
      expect(sql, `rpc ${fn} is called but not defined in schema.sql`).toMatch(
        new RegExp(`create function public\\.${fn}\\(`),
      );
    }
    // ENG-13 ואילך: לפחות פונקציית האריחים קיימת ונקראת
    expect(rpcCallsInFunctions()).toContain('stats_overview');
  });

  it('the session summary view exists and carries the test-session predicate', () => {
    const view = schema().match(
      /create or replace view public\.session_stats[\s\S]*?group by session_id;/,
    )?.[0];
    expect(view, 'session_stats view not found in schema.sql').toBeDefined();
    // ההגדרה המוסכמת: סשן בדיקה = url_test בתוך vars של session_start
    expect(view).toContain(`event_type = 'session_start'`);
    expect(view).toContain(`'url_test'`);
  });

  it('stats objects are revoked from browser-facing roles, like every other view', () => {
    const sql = schema();
    expect(sql).toMatch(/revoke all on public\.session_stats from anon, authenticated/);
    for (const fn of rpcCallsInFunctions()) {
      expect(sql, `function ${fn} must be revoked from anon/authenticated`).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`),
      );
    }
  });
});
