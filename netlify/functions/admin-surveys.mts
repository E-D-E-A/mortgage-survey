// Managing the list of surveys. first-edea editors only (requireAdmin before
// anything else).
//   GET                       → { surveys: [...] } including draft state and the latest version
//   POST   { slug, name }     → create a survey + a skeleton draft
//   PATCH  { slug, name?, archived? } → rename / archive / restore from archive
//   DELETE ?survey=<slug>     → a real delete, only for a survey never published
//
// Delete versus archive: a published version is immutable and respondent events
// point at it, so a survey that has been published is never deleted — it is
// archived. Archiving stops it being served to new sessions, but a respondent
// already mid-survey carries on (their version is pinned to the session).

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { isValidSlug } from '../../src/data/surveys';
import { starterConfig } from '../../src/questionnaire/starter';

const MAX_NAME_CHARS = 80;

interface SurveyRow {
  slug: string;
  name: string;
  created_at: string;
  created_by: string;
  archived_at: string | null;
}

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  if (req.method === 'GET') return listSurveys(env.url, headers);
  if (req.method === 'POST') return createSurvey(req, env.url, headers, session.email);
  if (req.method === 'PATCH') return patchSurvey(req, env.url, headers);
  if (req.method === 'DELETE') return deleteSurvey(req, env.url, headers);
  return new Response('method not allowed', { status: 405 });
};

/**
 * Three parallel queries joined in memory, instead of a PostgREST embed: the list
 * is small, and joining here does not depend on the FK names in the schema.
 * Exported so mcp-surveys.mts can serve the identical listing behind its own
 * rate limit, without a second copy of the join.
 */
export async function listSurveys(url: string, headers: Record<string, string>): Promise<Response> {
  const [surveysRes, draftsRes, configsRes] = await Promise.all([
    fetch(`${url}/rest/v1/surveys?select=slug,name,created_at,created_by,archived_at&order=created_at.asc`, { headers }),
    fetch(`${url}/rest/v1/survey_drafts?select=survey_id,updated_at,updated_by`, { headers }),
    fetch(`${url}/rest/v1/survey_configs?select=survey_id,version,published_at&order=published_at.desc`, { headers }),
  ]);
  if (!surveysRes.ok || !draftsRes.ok || !configsRes.ok) {
    return new Response('upstream error', { status: 502 });
  }

  const surveys = (await surveysRes.json()) as SurveyRow[];
  const drafts = (await draftsRes.json()) as {
    survey_id: string;
    updated_at: string;
    updated_by: string;
  }[];
  const configs = (await configsRes.json()) as {
    survey_id: string;
    version: string;
    published_at: string;
  }[];

  const draftBy = new Map(drafts.map((d) => [d.survey_id, d]));
  const versionCount = new Map<string, number>();
  const latest = new Map<string, { version: string; published_at: string }>();
  for (const c of configs) {
    versionCount.set(c.survey_id, (versionCount.get(c.survey_id) ?? 0) + 1);
    // The list is ordered by published_at descending — the first row per survey is its latest publish
    if (!latest.has(c.survey_id)) latest.set(c.survey_id, c);
  }

  return json({
    surveys: surveys.map((s) => ({
      ...s,
      has_draft: draftBy.has(s.slug),
      draft_updated_at: draftBy.get(s.slug)?.updated_at ?? null,
      draft_updated_by: draftBy.get(s.slug)?.updated_by ?? null,
      versions: versionCount.get(s.slug) ?? 0,
      latest_version: latest.get(s.slug)?.version ?? null,
      latest_published_at: latest.get(s.slug)?.published_at ?? null,
    })),
  });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, MAX_NAME_CHARS);
  return name.length > 0 ? name : null;
}

async function createSurvey(
  req: Request,
  url: string,
  headers: Record<string, string>,
  email: string,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return new Response('invalid json', { status: 400 });
  const slug = body.slug;
  const name = cleanName(body.name);
  if (!isValidSlug(slug)) return new Response('invalid slug', { status: 400 });
  if (!name) return new Response('invalid name', { status: 400 });

  const created = await fetch(`${url}/rest/v1/surveys`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ slug, name, created_by: email }),
  });
  if (created.status === 409) return new Response('slug already exists', { status: 409 });
  if (!created.ok) return new Response('upstream error', { status: 502 });

  // A skeleton draft right at creation — a survey with no draft is a state the
  // editor cannot fix from the survey list. A failure here does not undo the
  // survey: opening the editor will create one.
  const now = new Date().toISOString();
  await fetch(`${url}/rest/v1/survey_drafts`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      survey_id: slug,
      config: starterConfig(name),
      updated_at: now,
      updated_by: email,
    }),
  });

  return json({ slug, name });
}

async function patchSurvey(
  req: Request,
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await readBody(req);
  if (!body) return new Response('invalid json', { status: 400 });
  if (!isValidSlug(body.slug)) return new Response('invalid slug', { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return new Response('invalid name', { status: 400 });
    patch.name = name;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return new Response('invalid archived', { status: 400 });
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return new Response('nothing to update', { status: 400 });

  const res = await fetch(`${url}/rest/v1/surveys?slug=eq.${encodeURIComponent(body.slug)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) return new Response('survey not found', { status: 404 });
  return json(rows[0]);
}

async function deleteSurvey(
  req: Request,
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('survey') ?? '';
  if (!isValidSlug(slug)) return new Response('invalid slug', { status: 400 });

  // A published survey is not deleted — respondent events point at its versions.
  // The FK from survey_configs blocks this at the DB level too; the check here
  // exists to return an explanation instead of a bare 409.
  const published = await fetch(
    `${url}/rest/v1/survey_configs?survey_id=eq.${encodeURIComponent(slug)}&select=version&limit=1`,
    { headers },
  );
  if (!published.ok) return new Response('upstream error', { status: 502 });
  if (((await published.json()) as unknown[]).length > 0) {
    return new Response('survey has published versions', { status: 409 });
  }

  // The draft goes with the survey (on delete cascade), but deleting it
  // explicitly first keeps the behaviour identical even if the cascade is
  // missing on an older installation
  await fetch(`${url}/rest/v1/survey_drafts?survey_id=eq.${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers,
  });
  const res = await fetch(`${url}/rest/v1/surveys?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { ...headers, Prefer: 'return=representation' },
  });
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) return new Response('survey not found', { status: 404 });
  return json({ deleted: slug });
}
