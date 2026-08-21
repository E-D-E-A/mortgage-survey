// The tables side of the same guard tests/sync/stats-sql.test.ts keeps over the
// rpc functions: the Netlify functions and supabase/schema.sql share no type, so
// a table the code reads and the file never creates only fails in production.
//
// The bug this file was written after went the other way — schema.sql defined
// mcp_rate_hit correctly and the cloud project had simply never had that block
// applied, which no repo test can see. What the repo CAN hold is the half it
// owns: every object the code reaches for is defined in the file that creates
// them, so "apply schema.sql" is always a complete instruction. The other half —
// noticing the file was never applied — is the endpoint's job now, and lives in
// tests/mcp/schema-drift.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const schema = () => read('supabase/schema.sql');

/** Every source file behind the endpoints: the handlers and their shared lib. */
function functionSources(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(new URL('netlify/functions/', root), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mts')) files.push(`netlify/functions/${entry.name}`);
  }
  for (const entry of readdirSync(new URL('netlify/functions/lib/', root), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(`netlify/functions/lib/${entry.name}`);
  }
  return files;
}

/** Every PostgREST table or view the functions address by a literal name. */
function tablesInFunctions(): string[] {
  const names = new Set<string>();
  for (const file of functionSources()) {
    for (const m of read(file).matchAll(/rest\/v1\/([a-z_][a-z0-9_]*)/g)) {
      if (m[1] !== 'rpc') names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** The names in a literal `const X = [...] as const` array, for indirect reads. */
function stringArray(source: string, constName: string): string[] {
  const block = source.match(new RegExp(`const ${constName} = \\[([^\\]]*)\\]`))?.[1];
  return block ? [...block.matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]) : [];
}

const definesRelation = (sql: string, name: string): boolean =>
  new RegExp(`create (table if not exists|table|or replace view|view) public\\.${name}\\b`).test(sql);

describe('the tables the functions read stay in sync with schema.sql', () => {
  it('every table addressed by a literal name is created in schema.sql', () => {
    const sql = schema();
    const found = tablesInFunctions();
    // A regex that stopped matching would make this suite pass by testing
    // nothing at all — the same trap the rpc guard next door pins down.
    expect(found).toContain('survey_drafts');
    for (const name of found) {
      expect(definesRelation(sql, name), `${name} is read by a function but not defined in schema.sql`)
        .toBe(true);
    }
  });

  it('the MCP tables the rate limiter probes are the ones schema.sql creates', () => {
    // These are reached through an interpolated URL, so the scan above cannot
    // see them. They are the whole point of the probe: a drift report that
    // named a table schema.sql does not create would send the reader nowhere.
    const sql = schema();
    const probed = stringArray(read('netlify/functions/lib/mcp.ts'), 'MCP_TABLES');
    expect(probed).toEqual(['mcp_rate_limits', 'mcp_idempotency_keys', 'mcp_audit_log']);
    for (const name of probed) {
      expect(definesRelation(sql, name), `${name} is probed but not defined in schema.sql`).toBe(true);
    }
  });

  it('the MCP block grants every one of its objects to service_role', () => {
    // The functions hold the service_role key and nothing else. An object that
    // exists but is not granted fails exactly like one that does not exist —
    // with a different PostgREST code, and none of the drift guidance.
    const sql = schema();
    for (const name of ['mcp_rate_limits', 'mcp_idempotency_keys', 'mcp_audit_log']) {
      expect(sql, `${name} must be granted to service_role`).toMatch(
        new RegExp(`grant [a-z, ]*on public\\.${name}\\s+to service_role`),
      );
    }
    expect(sql).toMatch(
      /grant execute on function public\.mcp_rate_hit\([^)]*\) to service_role/,
    );
  });
});
