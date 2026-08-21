// The failure this suite exists for: supabase/schema.sql was in the repo but its
// MCP block had never been applied to the cloud project, so mcp_rate_hit — the
// first gate on every one of the seven tools — did not exist. PostgREST answered
// 404 PGRST202, the endpoint collapsed that into a bare `502 upstream error`,
// and the tool reported "Admin API call failed with status 502". That reads as
// an outage: the debugging went through a paused project and a broken deploy
// before the Supabase logs finally named the function.
//
// Two things are pinned here, on both sides of the MCP path:
//   - the endpoint distinguishes "the database is behind the code" (a permanent
//     deployment fault, reported as such and enumerated in full) from "the
//     database is unreachable" (the 502 it always was);
//   - the tool turns the first into an instruction a user can follow without
//     holding the Supabase logs or the Netlify deploy state.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { enforceRateLimit } from '../../netlify/functions/lib/mcp';
import { baseConfig, goldenConfig } from './fixtures';
import { connectHarness } from './helpers';

const ENV = { url: 'https://project.supabase.co', key: 'service-role-key' };

const postgrest = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** The exact bodies the real PostgREST returns for the two "not in the schema cache" cases. */
const MISSING_FUNCTION = {
  code: 'PGRST202',
  details:
    'Searched for the function public.mcp_rate_hit with parameters p_bucket, p_email, p_limit, p_window_seconds, but no matches were found in the schema cache.',
  hint: null,
  message: 'Could not find the function public.mcp_rate_hit(...) in the schema cache',
};
const missingTable = (name: string) => ({
  code: 'PGRST205',
  details: null,
  hint: null,
  message: `Could not find the table 'public.${name}' in the schema cache`,
});

/**
 * A stubbed PostgREST that knows which objects exist. Anything absent answers
 * exactly as the real one does, so the classification is tested against the
 * shape the database actually sends rather than an invented one.
 */
function stubDatabase(present: Set<string>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const path = new URL(String(input)).pathname.replace('/rest/v1/', '');
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      if (!present.has(fn)) return postgrest(404, MISSING_FUNCTION);
      return postgrest(200, [{ allowed: true, retry_after_seconds: 3600 }]);
    }
    if (!present.has(path)) return postgrest(404, missingTable(path));
    return postgrest(200, []);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const bodyOf = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('the rate limiter tells a missing schema from a broken database', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports every MCP object the database is missing, not just the first one', async () => {
    // The state the project was actually in: the whole MCP block unapplied.
    stubDatabase(new Set(['surveys', 'survey_drafts', 'survey_configs']));

    const res = await enforceRateLimit(ENV, 'dev@first-edea.com', 'read');
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(500);

    const body = await bodyOf(res!);
    expect(body.error).toBe('schema-drift');
    // Naming only mcp_rate_hit would send the reader to fix one object and hit
    // the next wall on the next call — apply_change needs the other three.
    expect(body.missing).toEqual([
      { kind: 'function', name: 'mcp_rate_hit' },
      { kind: 'table', name: 'mcp_rate_limits' },
      { kind: 'table', name: 'mcp_idempotency_keys' },
      { kind: 'table', name: 'mcp_audit_log' },
    ]);
    // The fix has to travel in the response: the caller may have no access to
    // the database logs at all.
    expect(body.message).toContain('supabase/schema.sql');
  });

  it('lists only what is actually absent when the drift is partial', async () => {
    stubDatabase(new Set(['mcp_rate_limits', 'mcp_audit_log']));

    const body = await bodyOf((await enforceRateLimit(ENV, 'dev@first-edea.com', 'write'))!);
    expect(body.missing).toEqual([
      { kind: 'function', name: 'mcp_rate_hit' },
      { kind: 'table', name: 'mcp_idempotency_keys' },
    ]);
  });

  it('a database that is genuinely broken is still a 502, and is not called drift', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => postgrest(503, { message: 'the database is not accepting connections' })),
    );

    const res = (await enforceRateLimit(ENV, 'dev@first-edea.com', 'read'))!;
    expect(res.status).toBe(502);
    const body = await bodyOf(res);
    expect(body.error).toBe('upstream');
    expect(body.target).toEqual({ kind: 'function', name: 'mcp_rate_hit' });
    // The upstream status is carried through, so the next reader does not have
    // to go and find out what the database actually said.
    expect(body.upstream_status).toBe(503);
  });

  it('never fails open: no reachable counter means no request passes', async () => {
    // The budget is the only ceiling on an agent loop. Every failure mode above
    // must return a Response; returning null would silently remove the limit.
    for (const stub of [
      () => stubDatabase(new Set()),
      () => vi.stubGlobal('fetch', vi.fn(async () => postgrest(500, { message: 'boom' }))),
      () => vi.stubGlobal('fetch', vi.fn(async () => postgrest(200, []))),
    ]) {
      vi.unstubAllGlobals();
      stub();
      expect(await enforceRateLimit(ENV, 'dev@first-edea.com', 'write')).toBeInstanceOf(Response);
    }
  });

  it('a working counter still passes a within-budget request through', async () => {
    stubDatabase(new Set(['mcp_rate_hit']));
    expect(await enforceRateLimit(ENV, 'dev@first-edea.com', 'read')).toBeNull();
  });
});

describe('the tools turn a stale database into an instruction, not a mystery', () => {
  const DRIFT = {
    status: 500,
    body: {
      error: 'schema-drift',
      missing: [
        { kind: 'function', name: 'mcp_rate_hit' },
        { kind: 'table', name: 'mcp_audit_log' },
      ],
      message: 'בסיס הנתונים חסר אובייקטים — יש להריץ את supabase/schema.sql מול הפרויקט',
    },
  };

  it('names the missing objects, the fix, and says not to retry', async () => {
    const h = await connectHarness();
    h.api.failNext = DRIFT;

    const res = await h.callTool('list_surveys');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('mcp_rate_hit');
    expect(res.text).toContain('mcp_audit_log');
    expect(res.text).toContain('supabase/schema.sql');
    // The two conclusions the old 502 sent the reader away from: it is not an
    // outage, and no other tool is worth trying — they share the same gate.
    expect(res.text).toMatch(/NOT an outage/i);
    expect(res.text).toMatch(/do not retry/i);
    await h.close();
  });

  it('says the same thing whichever tool ran into it', async () => {
    const h = await connectHarness();
    for (const [tool, args] of [
      ['get_draft', { survey: 'demo' }],
      ['get_audit_log', {}],
      ['create_survey', { survey: 'new-one', name: 'שאלון חדש' }],
    ] as const) {
      h.api.failNext = DRIFT;
      const res = await h.callTool(tool, args);
      expect(res.isError, tool).toBe(true);
      expect(res.text, tool).toContain('supabase/schema.sql');
    }
    await h.close();
  });

  it('a real upstream failure names what the call was reaching for', async () => {
    const h = await connectHarness();
    h.api.failNext = {
      status: 502,
      body: {
        error: 'upstream',
        target: { kind: 'table', name: 'survey_drafts' },
        upstream_status: 503,
        message: 'הקריאה לטבלה survey_drafts נכשלה מול בסיס הנתונים (503)',
      },
    };

    const res = await h.callTool('get_draft', { survey: 'demo' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('survey_drafts');
    // Distinct from drift: this one may pass on a retry, and must not be
    // reported with drift's "stop, apply the schema" instruction.
    expect(res.text).not.toContain('supabase/schema.sql');
    await h.close();
  });
});

describe('best-effort bookkeeping that failed is reported, not swallowed', () => {
  it('apply_change reports a write whose audit row never landed', async () => {
    const h = await connectHarness();
    const base = h.api.seedDraft('demo', baseConfig());

    const dry = await h.callTool<{ ok: boolean; change_id: string }>('propose_change', {
      survey: 'demo',
      config: goldenConfig(),
      base_updated_at: base,
      summary: 'הוספת פרסונה, ניסוי מחיר ומכסה',
    });
    expect(dry.structured.ok).toBe(true);

    h.api.warnOnWrite = ['השינוי בוצע אך לא נרשם ביומן השינויים: הטבלה mcp_audit_log אינה קיימת'];
    const applied = await h.callTool<{ applied: boolean; warnings?: string[] }>('apply_change', {
      change_id: dry.structured.change_id,
    });

    // The draft really was saved — this is a warning on a success, not an error.
    expect(applied.isError).toBe(false);
    expect(applied.structured.applied).toBe(true);
    expect(applied.structured.warnings).toEqual(h.api.warnOnWrite);
    expect(applied.text).toContain('mcp_audit_log');
    await h.close();
  });
});
