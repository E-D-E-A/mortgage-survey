// The MCP write path for survey drafts — the same survey_drafts row the console
// edits, behind deliberately stricter semantics. first-edea editors only
// (requireAdmin, exactly as the console endpoints).
//
// The console's admin-draft.mts stays as it is: a human mid-edit may save an
// invalid draft, and validation gates publishing only. An agent has no such
// excuse — it saves finished configs or nothing — so this endpoint:
//   - requires expected_updated_at, and a 409 carries the CURRENT updated_at
//     so the client can re-fetch cleanly;
//   - runs validateConfig and rejects configs with errors (422, full issue
//     list);
//   - enforces the analysis-code lock against the latest published version
//     (409, naming the locked codes);
//   - requires an idempotency key — replaying a key returns the stored result
//     without executing again;
//   - counts against a per-user hourly write budget (429 + retry-after);
//   - records every executed write in the audit log.
//
// GET here is the draft read for MCP tools: the same shape as admin-draft GET,
// plus (with ?include=published) the latest published config — which the MCP
// server needs for its dry-run code-lock check — behind the read budget.
//
// This endpoint can only ever touch survey_drafts and the MCP bookkeeping
// tables. There is deliberately no code path to survey_configs (publishing) or
// survey deletion — publishing stays a human action in /admin.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv, type SupabaseEnv } from './lib/supabase';
import {
  enforceRateLimit,
  findIdempotentReplay,
  recordAudit,
  storeIdempotentResult,
} from './lib/mcp';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';
import { validateConfig } from '../../src/engine/validate';
import { codeLockViolations } from '../../src/engine/lockedCodes';
import type { SurveyConfig } from '../../src/engine/types';

const MAX_CONFIG_BYTES = 500_000;
const MAX_IDEM_KEY_CHARS = 200;
const MAX_SUMMARY_CHARS = 500;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) {
    return json({ error: 'invalid-survey', message: 'מזהה השאלון אינו תקין' }, 400);
  }

  if (req.method === 'GET') return getDraft(req, env, session.email, slug);
  if (req.method === 'PUT') return putDraft(req, env, session.email, slug);
  return json({ error: 'method-not-allowed' }, 405);
};

async function getDraft(
  req: Request,
  env: SupabaseEnv,
  email: string,
  slug: string,
): Promise<Response> {
  const limited = await enforceRateLimit(env, email, 'read');
  if (limited) return limited;

  const headers = supaHeaders(env.key);
  const scope = `survey_id=eq.${encodeURIComponent(slug)}`;
  const res = await fetch(
    `${env.url}/rest/v1/survey_drafts?${scope}&select=config,updated_at`,
    { headers },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const rows = (await res.json()) as { config: unknown; updated_at: string }[];
  const draft = rows.length > 0 ? rows[0] : { config: null, updated_at: null };

  if (new URL(req.url).searchParams.get('include') !== 'published') return json(draft);

  // The published side, for the dry-run code-lock check: how many versions
  // exist, and the latest one's config. One extra query, only when asked for.
  const pubRes = await fetch(
    `${env.url}/rest/v1/survey_configs?${scope}&select=version,config&order=published_at.desc`,
    { headers },
  );
  if (!pubRes.ok) return new Response('upstream error', { status: 502 });
  const published = (await pubRes.json()) as { version: string; config: unknown }[];
  return json({
    ...draft,
    published_versions: published.length,
    latest_published: published.length > 0 ? published[0] : null,
  });
}

async function putDraft(
  req: Request,
  env: SupabaseEnv,
  email: string,
  slug: string,
): Promise<Response> {
  const text = await req.text();
  if (text.length > MAX_CONFIG_BYTES) {
    return json(
      {
        error: 'config-too-large',
        max_bytes: MAX_CONFIG_BYTES,
        message: 'הקונפיג גדול מ־500KB — יש לצמצם אותו לפני שמירה',
      },
      413,
    );
  }

  let body: {
    config?: unknown;
    expected_updated_at?: unknown;
    idempotency_key?: unknown;
    summary?: unknown;
  };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return json({ error: 'invalid-json', message: 'גוף הבקשה אינו JSON תקין' }, 400);
  }

  const { config, expected_updated_at: expected, idempotency_key: idemKey, summary } = body;
  const configShapeOk =
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as { screens?: unknown }).screens);
  const idemKeyOk =
    typeof idemKey === 'string' && idemKey.length > 0 && idemKey.length <= MAX_IDEM_KEY_CHARS;
  const summaryOk =
    typeof summary === 'string' && summary.trim().length > 0 && summary.length <= MAX_SUMMARY_CHARS;
  if (
    !configShapeOk ||
    !idemKeyOk ||
    !summaryOk ||
    (expected !== null && typeof expected !== 'string')
  ) {
    return json(
      {
        error: 'invalid-request',
        message:
          'הבקשה חייבת לכלול config עם רשימת מסכים, expected_updated_at (או null לטיוטה ראשונה), idempotency_key ותקציר שינוי',
      },
      400,
    );
  }

  // Idempotency replay comes before the budget: returning a stored result
  // executes nothing, so a network-level retry never burns a write.
  const replay = await findIdempotentReplay(env, email, idemKey);
  if (replay instanceof Response) return replay;
  if (replay) {
    return json(replay.response, replay.status, { 'X-Idempotent-Replay': 'true' });
  }

  const limited = await enforceRateLimit(env, email, 'write');
  if (limited) return limited;

  // The validation gate. The console path deliberately skips this (a human may
  // save mid-edit); the agent path deliberately does not.
  const issues = validateConfig(config as SurveyConfig);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  if (errors.length > 0) {
    return json({ error: 'validation', errors, warnings }, 422);
  }

  // The analysis-code lock, against the latest published version. Enforced
  // here and not only in the MCP server's dry run — the dry run is advice, and
  // anyone can run a client that skips it.
  const headers = supaHeaders(env.key);
  const scope = `survey_id=eq.${encodeURIComponent(slug)}`;
  const pubRes = await fetch(
    `${env.url}/rest/v1/survey_configs?${scope}&select=config&order=published_at.desc&limit=1`,
    { headers },
  );
  if (!pubRes.ok) return new Response('upstream error', { status: 502 });
  const publishedRows = (await pubRes.json()) as { config: SurveyConfig }[];
  if (publishedRows.length > 0) {
    const locked = codeLockViolations(publishedRows[0].config, config as SurveyConfig);
    if (locked.length > 0) {
      return json(
        {
          error: 'code-lock',
          locked,
          message:
            'השאלון כבר פורסם, ולכן קודי האנליזה שבשימוש בגרסה שפורסמה נעולים — שינוי שם היה מנתק אותם מהתשובות שכבר נאספו',
        },
        409,
      );
    }
  }

  const now = new Date().toISOString();

  if (expected === null) {
    // The survey's first draft. An existing draft means the client's picture is
    // stale — same 409-with-current-state contract as the update path below.
    const res = await fetch(`${env.url}/rest/v1/survey_drafts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ survey_id: slug, config, updated_at: now, updated_by: email }),
    });
    if (res.status === 409) {
      const detail = await res.text();
      if (detail.includes('survey_drafts_survey_id_fkey')) {
        return json({ error: 'survey-not-found', message: 'השאלון לא קיים' }, 404);
      }
      return conflictWithCurrent(env, slug);
    }
    if (!res.ok) return new Response('upstream error', { status: 502 });
    return finishWrite(env, email, idemKey, slug, null, now, summary as string);
  }

  const res = await fetch(
    `${env.url}/rest/v1/survey_drafts?${scope}&updated_at=eq.${encodeURIComponent(expected as string)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ config, updated_at: now, updated_by: email }),
    },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const updated = (await res.json()) as unknown[];
  if (updated.length === 0) return conflictWithCurrent(env, slug);

  return finishWrite(env, email, idemKey, slug, expected as string, now, summary as string);
}

/**
 * The optimistic-lock 409, carrying the draft's CURRENT updated_at so the
 * client can re-fetch and re-propose without a second round trip to discover
 * what it lost to.
 */
async function conflictWithCurrent(env: SupabaseEnv, slug: string): Promise<Response> {
  const res = await fetch(
    `${env.url}/rest/v1/survey_drafts?survey_id=eq.${encodeURIComponent(slug)}&select=updated_at`,
    { headers: supaHeaders(env.key) },
  );
  const rows = res.ok ? ((await res.json()) as { updated_at: string }[]) : [];
  return json(
    {
      error: 'draft-conflict',
      current_updated_at: rows.length > 0 ? rows[0].updated_at : null,
      message:
        'הטיוטה השתנתה מאז שנטענה (כנראה שמירה מקבילה בקונסולה) — יש לטעון אותה מחדש ולהציע את השינוי מחדש',
    },
    409,
  );
}

async function finishWrite(
  env: SupabaseEnv,
  email: string,
  idemKey: string,
  slug: string,
  before: string | null,
  after: string,
  summary: string,
): Promise<Response> {
  await recordAudit(env, {
    user_email: email,
    survey_id: slug,
    revision_before: before,
    revision_after: after,
    summary: summary.trim(),
  });
  const response = { updated_at: after };
  await storeIdempotentResult(env, email, idemKey, slug, 200, response);
  return json(response);
}
