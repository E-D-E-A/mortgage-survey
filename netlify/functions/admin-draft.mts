// A survey draft (one row per survey). first-edea editors only (requireAdmin
// before anything else).
// The ?survey=<slug> parameter selects the survey; without it — the default survey.
// GET → { config, updated_at } | { config: null }
// PUT { config, expected_updated_at } → a save with optimistic locking:
//   an expected_updated_at that does not match the DB ⇒ 409 (someone saved
//   concurrently).
// A draft is allowed to be invalid — validation only blocks publishing.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';

const MAX_CONFIG_BYTES = 500_000;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });
  const scope = `survey_id=eq.${encodeURIComponent(slug)}`;

  if (req.method === 'GET') {
    const res = await fetch(
      `${env.url}/rest/v1/survey_drafts?${scope}&select=config,updated_at`,
      { headers },
    );
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const rows = (await res.json()) as { config: unknown; updated_at: string }[];
    return json(rows.length > 0 ? rows[0] : { config: null, updated_at: null });
  }

  if (req.method !== 'PUT') {
    return new Response('method not allowed', { status: 405 });
  }

  const text = await req.text();
  if (text.length > MAX_CONFIG_BYTES) {
    return new Response('config too large', { status: 413 });
  }

  let config: unknown;
  let expected: unknown;
  try {
    ({ config, expected_updated_at: expected } = JSON.parse(text) as {
      config?: unknown;
      expected_updated_at?: unknown;
    });
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  const isShapeOk =
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as { screens?: unknown }).screens);
  if (!isShapeOk || (expected !== null && typeof expected !== 'string')) {
    return new Response('invalid draft', { status: 400 });
  }

  const now = new Date().toISOString();

  if (expected === null) {
    // Creating the survey's first draft; if one already exists — 409 (someone
    // got there first). A survey that does not exist is blocked by the FK and
    // also returns 409 from PostgREST; the two are told apart so the editor is
    // not shown "someone got there before you" for a survey that was deleted.
    const res = await fetch(`${env.url}/rest/v1/survey_drafts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        survey_id: slug,
        config,
        updated_at: now,
        updated_by: session.email,
      }),
    });
    if (res.status === 409) {
      const detail = await res.text();
      return detail.includes('survey_drafts_survey_id_fkey')
        ? new Response('survey not found', { status: 404 })
        : new Response('draft already exists', { status: 409 });
    }
    if (!res.ok) return new Response('upstream error', { status: 502 });
    return json({ updated_at: now });
  }

  const res = await fetch(
    `${env.url}/rest/v1/survey_drafts?${scope}&updated_at=eq.${encodeURIComponent(expected as string)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ config, updated_at: now, updated_by: session.email }),
    },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const updated = (await res.json()) as unknown[];
  if (updated.length === 0) {
    // The draft changed since it was loaded — the save is rejected rather than overwrite it
    return new Response('draft changed concurrently', { status: 409 });
  }
  return json({ updated_at: now });
};
