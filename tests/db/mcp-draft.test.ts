// The MCP write path's real enforcement, against the real endpoint and the
// local Supabase stack: auth, optimistic locking, the validation gate, the
// code lock, idempotency replay, the rate limit, the audit log, and a Hebrew
// byte-for-byte round-trip. Everything the MCP server claims the backend
// guarantees is proven here — on the backend, not on a fake.
//
// Runs only with DB_TESTS=1 (npx supabase start).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applySchema,
  connectLocal,
  createAdminUser,
  dbTestsEnabled,
  LOCAL_API_URL,
  LOCAL_SERVICE_ROLE_KEY,
  signIn,
  type Sql,
} from './harness';
import { ensureSurvey } from './fixtures';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';

const SLUG = 'mcptest';
const SLUG2 = 'mcptest2';
const ADMIN = 'mcp-admin@first-edea.com';
const OUTSIDER = 'mcp-outsider@gmail.com';

const clean = (): SurveyConfig => ({
  version: 'draft',
  screens: [
    {
      id: 'intro',
      type: 'info',
      title: 'שלום',
      body: 'ברוכים הבאים.\nזו שורה שנייה עם "מרכאות" ו־״גרשיים״.',
    },
    {
      id: 's_status',
      type: 'single',
      prompt: 'מי אתם?',
      options: [
        { id: 'young_couple', label: 'זוג צעיר' },
        { id: 'other', label: 'אחר' },
      ],
      onSubmit: [
        { var: 'persona', value: 'young_couple', if: { q: 's_status', op: 'eq', value: 'young_couple' } },
        { var: 'persona', value: 'other', if: { not: { q: 's_status', op: 'eq', value: 'young_couple' } } },
      ],
    },
    { id: 'end', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
});

/** The same survey without the persona mark — a code-lock violation once published. */
const withoutPersona = (): SurveyConfig => {
  const config = clean();
  for (const screen of config.screens) delete screen.onSubmit;
  return config;
};

const broken = (): SurveyConfig => ({
  version: 'draft',
  screens: [
    {
      id: 'a',
      type: 'info',
      title: 'שאלה',
      body: '',
      next: [{ goto: 'no_such_screen' }],
    },
    { id: 'e', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
});

describe.runIf(dbTestsEnabled)('mcp-draft: the strict agent write path', () => {
  let sql: Sql;
  let token: string;

  const put = async (auth: string | null, body: unknown, slug = SLUG) => {
    const { default: handler } = await import('../../netlify/functions/mcp-draft.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(
      new Request(`http://localhost/.netlify/functions/mcp-draft?survey=${slug}`, {
        method: 'PUT',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  };

  const get = async (auth: string | null, params = '') => {
    const { default: handler } = await import('../../netlify/functions/mcp-draft.mts');
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${auth}` } : {};
    return handler(
      new Request(`http://localhost/.netlify/functions/mcp-draft?survey=${SLUG}${params}`, {
        headers,
      }),
    );
  };

  const draftRow = async () => {
    const rows = await sql`select config, updated_at from survey_drafts where survey_id = ${SLUG}`;
    return rows.length > 0 ? rows[0] : null;
  };

  const clearState = async () => {
    await sql`delete from survey_drafts where survey_id in (${SLUG}, ${SLUG2})`;
    await sql`delete from mcp_idempotency_keys where survey_id in (${SLUG}, ${SLUG2})`;
    await sql`delete from mcp_audit_log where survey_id in (${SLUG}, ${SLUG2})`;
    await sql`delete from mcp_rate_limits where true`;
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(732913)`;
      await tx`alter table survey_configs disable trigger survey_configs_immutable`;
      await tx`delete from survey_configs where survey_id = ${SLUG}`;
      await tx`alter table survey_configs enable trigger survey_configs_immutable`;
    });
  };

  beforeAll(async () => {
    process.env.SUPABASE_URL = LOCAL_API_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE_ROLE_KEY;
    // Generous defaults so only the dedicated test exercises the 429
    process.env.MCP_WRITE_LIMIT_PER_HOUR = '10000';
    process.env.MCP_READ_LIMIT_PER_HOUR = '10000';
    sql = connectLocal();
    await applySchema(sql);
    await sql`insert into surveys (slug, name, created_by)
              values (${SLUG}, 'שאלון MCP', 'test') on conflict (slug) do nothing`;
    await sql`insert into surveys (slug, name, created_by)
              values (${SLUG2}, 'שאלון MCP ב', 'test') on conflict (slug) do nothing`;
    await createAdminUser(ADMIN);
    await createAdminUser(OUTSIDER);
    token = await signIn(ADMIN);
  });

  beforeEach(clearState);

  afterAll(async () => {
    await sql?.end();
  });

  const validPut = (over: Record<string, unknown> = {}) => ({
    config: clean(),
    expected_updated_at: null,
    idempotency_key: `key-${Math.random().toString(36).slice(2)}`,
    summary: 'שינוי בדיקה',
    ...over,
  });

  it('requires a first-edea editor, exactly like the console endpoints', async () => {
    expect((await put(null, validPut())).status).toBe(401);
    expect((await put(await signIn(OUTSIDER), validPut())).status).toBe(403);
    expect(await draftRow()).toBeNull();
  });

  it('rejects a request without idempotency key or summary', async () => {
    const noKey = await put(token, { config: clean(), expected_updated_at: null, summary: 'x' });
    expect(noKey.status).toBe(400);
    const noSummary = await put(token, {
      config: clean(),
      expected_updated_at: null,
      idempotency_key: 'k1',
    });
    expect(noSummary.status).toBe(400);
    expect(await draftRow()).toBeNull();
  });

  it('optimistic lock: a mismatched revision → 409 carrying the CURRENT updated_at', async () => {
    const first = await put(token, validPut());
    expect(first.status).toBe(200);
    const { updated_at: current } = (await first.json()) as { updated_at: string };

    const res = await put(
      token,
      validPut({ expected_updated_at: '2020-01-01T00:00:00.000Z' }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; current_updated_at: string };
    expect(body.error).toBe('draft-conflict');
    expect(new Date(body.current_updated_at).toISOString()).toBe(
      new Date(current).toISOString(),
    );
  });

  it('validation gate: a config with errors is refused with the full validateConfig list', async () => {
    const res = await put(token, validPut({ config: broken() }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; errors: unknown };
    expect(body.error).toBe('validation');
    expect(body.errors).toEqual(validateConfig(broken()).filter((i) => i.level === 'error'));
    expect(await draftRow()).toBeNull();
  });

  it('code lock: dropping a published mark → 409 naming the locked codes; before publish it is allowed', async () => {
    // Before any publish the codes are open — the write goes through
    const beforePublish = await put(token, validPut({ config: withoutPersona() }));
    expect(beforePublish.status).toBe(200);
    const { updated_at } = (await beforePublish.json()) as { updated_at: string };

    await ensureSurvey(sql, SLUG, 'שאלון MCP', [
      { version: `2026-08-01.1-${SLUG}`, config: clean() },
    ]);

    const res = await put(
      token,
      validPut({ config: withoutPersona(), expected_updated_at: updated_at }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; locked: { name: string }[] };
    expect(body.error).toBe('code-lock');
    expect(body.locked.map((v) => v.name)).toContain('persona');
  });

  it('idempotency: replaying a key returns the stored result and executes nothing', async () => {
    const key = 'replay-key-1';
    const first = await put(token, validPut({ idempotency_key: key }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { updated_at: string };

    // Same key, different config and a stale revision — must replay, not execute
    const replay = await put(
      token,
      validPut({
        idempotency_key: key,
        config: broken(),
        expected_updated_at: '2020-01-01T00:00:00.000Z',
      }),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('X-Idempotent-Replay')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);

    // jsonb does not preserve key order, so compare structure, not bytes
    const row = await draftRow();
    expect(row!.config).toEqual(clean());
    const audit = await sql`select * from mcp_audit_log where survey_id = ${SLUG}`;
    expect(audit).toHaveLength(1);

    // The key is scoped per survey: the same key on ANOTHER survey must
    // execute there, not silently replay this survey's stored result.
    const other = await put(token, validPut({ idempotency_key: key }), SLUG2);
    expect(other.status).toBe(200);
    expect(other.headers.get('X-Idempotent-Replay')).toBeNull();
    const rows = await sql`select config from survey_drafts where survey_id = ${SLUG2}`;
    expect(rows).toHaveLength(1);
  });

  it('rate limit: writes beyond the hourly budget → 429 with retry-after seconds', async () => {
    process.env.MCP_WRITE_LIMIT_PER_HOUR = '2';
    try {
      const rlUser = 'mcp-rl@first-edea.com';
      await createAdminUser(rlUser);
      const rlToken = await signIn(rlUser);

      const first = await put(rlToken, validPut());
      expect(first.status).toBe(200);
      const { updated_at } = (await first.json()) as { updated_at: string };
      const second = await put(rlToken, validPut({ expected_updated_at: updated_at }));
      expect(second.status).toBe(200);
      const { updated_at: second_at } = (await second.json()) as { updated_at: string };

      const third = await put(rlToken, validPut({ expected_updated_at: second_at }));
      expect(third.status).toBe(429);
      expect(third.headers.get('Retry-After')).toMatch(/^\d+$/);
      const body = (await third.json()) as { error: string; retry_after_seconds: number };
      expect(body.error).toBe('rate-limit');
      expect(body.retry_after_seconds).toBeGreaterThan(0);
      expect(body.retry_after_seconds).toBeLessThanOrEqual(3600);

      // A replay executes nothing, so an exhausted WRITE budget must not block
      // it — that is what keeps a retry after a network failure safe. It is
      // metered against the read budget instead (generous here).
      const [{ idem_key }] = await sql`
        select idem_key from mcp_idempotency_keys
        where user_email = ${rlUser} order by created_at asc limit 1`;
      const replay = await put(rlToken, validPut({ idempotency_key: idem_key as string }));
      expect(replay.status).toBe(200);
      expect(replay.headers.get('X-Idempotent-Replay')).toBe('true');

      // The budget is per user — the other editor is unaffected. The draft
      // already exists (the rl user created it), so the write needs the
      // current revision: the second write's, since the third never executed.
      expect((await put(token, validPut({ expected_updated_at: second_at }))).status).toBe(200);
    } finally {
      process.env.MCP_WRITE_LIMIT_PER_HOUR = '10000';
    }
  });

  it('audit log: every executed write records who, when, revisions and the summary', async () => {
    const first = await put(token, validPut({ summary: 'טיוטה ראשונה' }));
    const { updated_at: rev1 } = (await first.json()) as { updated_at: string };
    await put(
      token,
      validPut({ summary: 'עדכון שני', expected_updated_at: rev1 }),
    );

    const { default: auditHandler } = await import('../../netlify/functions/mcp-audit.mts');
    const unauthorized = await auditHandler(
      new Request(`http://localhost/.netlify/functions/mcp-audit?survey=${SLUG}`),
    );
    expect(unauthorized.status).toBe(401);

    const res = await auditHandler(
      new Request(`http://localhost/.netlify/functions/mcp-audit?survey=${SLUG}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as {
      entries: {
        user_email: string;
        summary: string;
        revision_before: string | null;
        revision_after: string;
      }[];
    };
    expect(entries).toHaveLength(2);
    // Newest first
    expect(entries[0].summary).toBe('עדכון שני');
    expect(new Date(entries[0].revision_before!).toISOString()).toBe(
      new Date(rev1).toISOString(),
    );
    expect(entries[1].summary).toBe('טיוטה ראשונה');
    expect(entries[1].revision_before).toBeNull();
    expect(entries.every((e) => e.user_email === ADMIN)).toBe(true);
  });

  it('the 500KB cap answers 413', async () => {
    const config = clean();
    (config.screens[0] as { body: string }).body = 'ש'.repeat(600_000);
    const res = await put(token, validPut({ config }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('config-too-large');
  });

  it('Hebrew content round-trips byte-identical through the real database', async () => {
    const config = clean();
    const saved = await put(token, validPut({ config }));
    expect(saved.status).toBe(200);

    const res = await get(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: SurveyConfig };
    // jsonb reorders keys (a storage property the console lives with too), so
    // "byte-identical" is asserted where it matters: the structure is intact
    // and every piece of Hebrew text — quotes, newlines, gershayim, maqaf —
    // comes back as the exact same string.
    expect(body.config).toEqual(config);
    const intro = body.config.screens[0] as { body: string };
    expect(intro.body).toBe('ברוכים הבאים.\nזו שורה שנייה עם "מרכאות" ו־״גרשיים״.');
  });

  it('GET with include=published serves the code-lock context', async () => {
    await put(token, validPut());
    await ensureSurvey(sql, SLUG, 'שאלון MCP', [
      { version: `2026-08-02.1-${SLUG}`, config: clean() },
    ]);

    const res = await get(token, '&include=published');
    const body = (await res.json()) as {
      published_versions: number;
      latest_published: { version: string; config: unknown };
    };
    expect(body.published_versions).toBe(1);
    expect(body.latest_published.version).toBe(`2026-08-02.1-${SLUG}`);
    expect(body.latest_published.config).toEqual(clean());
  });

  it('mcp-surveys serves the listing to editors only', async () => {
    const { default: surveysHandler } = await import('../../netlify/functions/mcp-surveys.mts');
    expect(
      (await surveysHandler(new Request('http://localhost/.netlify/functions/mcp-surveys'))).status,
    ).toBe(401);

    const res = await surveysHandler(
      new Request('http://localhost/.netlify/functions/mcp-surveys', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const { surveys } = (await res.json()) as { surveys: { slug: string }[] };
    expect(surveys.map((s) => s.slug)).toContain(SLUG);
  });
});
