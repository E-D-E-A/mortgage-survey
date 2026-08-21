// Publishing a survey draft as a new, permanent version. first-edea editors only.
// The ?survey=<slug> parameter selects the survey; without it — the default survey.
// The real validation gate: the same validateConfig that runs in the editor runs
// here too — errors block (422), warnings pass through and are returned for
// information.
// POST { label? } → { version, warnings }

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug, MAX_VERSION_CHARS } from '../../src/data/surveys';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';


export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });

  let label = '';
  try {
    const body = (await req.json()) as { label?: unknown };
    if (typeof body.label === 'string') {
      // A free-form label → a safe version suffix (letters/digits/hyphen only)
      label = body.label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9֐-׾]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    }
  } catch {
    /* an empty body is allowed */
  }

  const draftRes = await fetch(
    `${env.url}/rest/v1/survey_drafts?survey_id=eq.${encodeURIComponent(slug)}&select=config`,
    { headers },
  );
  if (!draftRes.ok) return new Response('upstream error', { status: 502 });
  const drafts = (await draftRes.json()) as { config: SurveyConfig }[];
  if (drafts.length === 0) {
    return new Response('no draft to publish', { status: 404 });
  }
  const config = drafts[0].config;

  const issues = validateConfig(config);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  if (errors.length > 0) {
    return json({ errors, warnings }, 422);
  }

  // Version numbering: YYYY-MM-DD.N-<slug>, counting that survey's versions on
  // that day. The slug is part of the string, which keeps version globally
  // unique — and that is critical, because survey_events carries only
  // survey_version, with no survey id of its own.
  const date = new Date().toISOString().slice(0, 10);
  const existingRes = await fetch(
    `${env.url}/rest/v1/survey_configs?survey_id=eq.${encodeURIComponent(slug)}` +
      `&version=like.${encodeURIComponent(date)}*&select=version`,
    { headers },
  );
  if (!existingRes.ok) return new Response('upstream error', { status: 502 });
  const existing = (await existingRes.json()) as { version: string }[];
  let n = 1;
  for (const row of existing) {
    const m = row.version.match(/^\d{4}-\d{2}-\d{2}\.(\d+)/);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }

  // Retry: a PK collision (a concurrent publish, or a slug+label combination that
  // already exists) → another attempt with N+1
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = `${date}.${n + attempt}-${slug}${label ? `-${label}` : ''}`.slice(
      0,
      MAX_VERSION_CHARS,
    );
    const published: SurveyConfig = { ...config, version };
    const res = await fetch(`${env.url}/rest/v1/survey_configs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        version,
        survey_id: slug,
        config: published,
        published_by: session.email,
      }),
    });
    if (res.ok) {
      return json({ version, warnings });
    }
    if (res.status !== 409) return new Response('upstream error', { status: 502 });
  }
  return new Response('version conflict, try again', { status: 409 });
};
