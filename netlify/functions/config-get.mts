// The public read endpoint for a survey config. No authentication — the config is
// shown to every respondent anyway.
// ?version=<v> returns a pinned version (immutable — a session that started on it
//   carries on with it), and keeps working for an archived survey too, so a
//   respondent who is mid-survey can finish.
// ?survey=<slug> returns the latest published version of that survey;
//   without the parameter — the default survey (the old link, `/`).
// An archived survey returns 410 for a new session: the link was handed out, and
// the respondent deserves an explanation rather than an error.

import { DEFAULT_SURVEY_SLUG, isValidSlug, MAX_VERSION_CHARS } from '../../src/data/surveys';


export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response('server not configured', { status: 503 });
  }
  const headers = { apikey: supaKey, Authorization: `Bearer ${supaKey}` };

  const params = new URL(req.url).searchParams;
  const version = params.get('version');
  const slug = params.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (version !== null && (version.length === 0 || version.length > MAX_VERSION_CHARS)) {
    return new Response('invalid version', { status: 400 });
  }
  if (!isValidSlug(slug)) {
    return new Response('invalid survey', { status: 400 });
  }

  if (!version) {
    // A new session: the survey has to exist and not be archived
    const surveyRes = await fetch(
      `${supaUrl}/rest/v1/surveys?slug=eq.${encodeURIComponent(slug)}&select=archived_at&limit=1`,
      { headers },
    );
    if (!surveyRes.ok) return new Response('upstream error', { status: 502 });
    const rows = (await surveyRes.json()) as { archived_at: string | null }[];
    if (rows.length === 0) return new Response('not found', { status: 404 });
    if (rows[0].archived_at) return new Response('survey closed', { status: 410 });
  }

  const query = version
    ? `version=eq.${encodeURIComponent(version)}&select=survey_id,version,config&limit=1`
    : `survey_id=eq.${encodeURIComponent(slug)}&select=survey_id,version,config` +
      `&order=published_at.desc&limit=1`;

  const res = await fetch(`${supaUrl}/rest/v1/survey_configs?${query}`, { headers });
  if (!res.ok) {
    return new Response('upstream error', { status: 502 });
  }

  const rows = (await res.json()) as { survey_id: string; version: string; config: unknown }[];
  if (rows.length === 0) {
    return new Response('not found', { status: 404 });
  }

  const { survey_id, version: v, config } = rows[0];
  return new Response(JSON.stringify({ survey: survey_id, version: v, config }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // A pinned version never changes (a trigger in the schema) — aggressive
      // caching is safe. The active version changes on publish — a short cache only.
      'Cache-Control': version
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60, must-revalidate',
    },
  });
};
