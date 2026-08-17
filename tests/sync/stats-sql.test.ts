// The statistics SQL layer lives in two worlds that share no type: schema.sql and
// the rpc calls in the Netlify functions. Drift between them only fails in
// production — hence these tests, in the same spirit as src/data/events.test.ts.
// They always run, with no DB.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const schema = () => read('supabase/schema.sql');

/**
 * Every rpc call across all the Netlify functions — both an explicit URL
 * (rest/v1/rpc/<name>) and the rpc(env, '<name>', ...) helper, the form
 * admin-stats calls through.
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
    // ENG-13 onwards: at least the overview-tiles function exists and is called
    expect(rpcCallsInFunctions()).toContain('stats_overview');
  });

  it('the session summary view exists and carries the test-session predicate', () => {
    const view = schema().match(
      /create or replace view public\.session_stats[\s\S]*?group by session_id;/,
    )?.[0];
    expect(view, 'session_stats view not found in schema.sql').toBeDefined();
    // The agreed definition: a test session = url_test inside session_start's vars
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

  it('every rpc the functions call is granted to service_role', () => {
    // The revoke above is only half the pair. A schema edit that revokes and
    // forgets to re-grant leaves the endpoint failing in production while every
    // test here still passes — and for quota-get, failing means failing open, so
    // nothing would report it at all.
    const sql = schema();
    for (const fn of rpcCallsInFunctions()) {
      expect(sql, `function ${fn} must be granted to service_role`).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`),
      );
    }
  });

  it('quota_counts counts finished, non-test sessions only', () => {
    // The two filters that decide whether a real study's quotas close early.
    // Unlike the session_stats predicate above, they had no guard at all: the
    // function is defined with drop/create, so an edit that dropped either
    // filter would keep the signature and pass every other test in the repo.
    const fn = schema().match(/create function public\.quota_counts\([\s\S]*?\$\$;/)?.[0];
    expect(fn, 'quota_counts not found in schema.sql').toBeDefined();
    expect(fn).toContain(`s.outcome = 'complete'`);
    expect(fn).toContain('not s.is_test');
  });

  it('the open-answers listing never filters or ranks by the text itself', () => {
    // ENG-16's hard scope guard: the tab browses raw answers, and searching or
    // scoring their content is out of scope by decision, not by omission.
    const fn = schema().match(/create function public\.open_answers\([\s\S]*?\$\$;/)?.[0];
    expect(fn, 'open_answers not found in schema.sql').toBeDefined();
    expect(fn).not.toMatch(/ilike|to_tsvector|to_tsquery|websearch_to_tsquery|similarity\(/i);
  });
});
