// ENG-19's standing constraint: the browser never talks to the database.
//
// Everything the console and the respondent app need goes through a Netlify
// function, which holds the service_role key server-side. The anon key that does
// reach the browser is for Supabase Auth alone — RLS grants it nothing.
//
// This is an architectural promise, and the only way it ever breaks is by
// someone adding a shortcut that works perfectly in development. Nothing in the
// running app would complain; the damage is that a key or a table becomes
// reachable from a page. So the assertion is made against the source itself.
//
// Always runs, with no DB — in the same spirit as tests/sync/stats-sql.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

/** Every hand-written source file the browser bundle is built from. */
function browserSources(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(`${dir}/`, root), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...browserSources(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('the browser never reaches the database directly', () => {
  it('only the auth adapter pulls in the supabase client library', () => {
    // Anywhere else, an import of this library is the start of a direct query —
    // there is nothing else in it the browser has any business with.
    const importers = browserSources().filter((f) => read(f).includes('@supabase/supabase-js'));
    expect(importers).toEqual(['src/admin/supabaseClient.ts']);
  });

  it('no browser code selects from a table or calls PostgREST', () => {
    for (const file of browserSources()) {
      const src = read(file);
      expect(src, `${file} queries a table directly`).not.toMatch(/supabase\s*\.\s*from\s*\(/);
      expect(src, `${file} calls PostgREST directly`).not.toMatch(/rest\/v1/);
    }
  });

  it('every file that calls fetch is calling a Netlify function', () => {
    // Four do today: the console's api layer, and the respondent's config, events
    // and quota loaders. A fifth that pointed somewhere else would be the shortcut
    // this file exists to catch.
    const callers = browserSources().filter((f) => /\bfetch\s*\(/.test(read(f)));
    expect(callers.length).toBeGreaterThan(0);
    for (const file of callers) {
      expect(read(file), `${file} calls fetch without naming a Netlify function`).toContain(
        '/.netlify/functions/',
      );
    }
  });

  it('the service-role key is named only on the server side', () => {
    // The one secret that must never be reachable from a page. Vite inlines any
    // import.meta.env value it can see, so naming it in browser code is enough to
    // ship it.
    for (const file of browserSources()) {
      expect(read(file), `${file} names the service-role key`).not.toMatch(/SERVICE_ROLE/i);
    }
  });
});
