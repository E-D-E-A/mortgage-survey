// The published versions of a survey — read-only, first-edea editors only.
//
// This is the one thing the console could never do: once a version was
// published its content was unreadable from the admin side, because nothing
// here returned it. The respondent endpoint (config-get) does serve a version
// by name, but it is public and takes no account of who is asking, so the
// console needs its own door behind requireAdmin.
//
//   GET ?survey=<slug>              → { versions: [{ version, published_at }] }
//                                     newest first
//   GET ?survey=<slug>&version=<v>  → { version, published_at, config }
//
// Read-only by construction: no method other than GET is served. Publishing
// stays with admin-publish, and a published row is never rewritten — it is the
// frozen thing the collected answers refer to.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { isValidSlug, MAX_VERSION_CHARS } from '../../src/data/surveys';


/**
 * How many versions the picker asks for. Newest first, so a survey with a long
 * publish history still gets the ones anybody looks at; the alternative was an
 * unbounded select that grows for the life of the survey.
 */
const LIST_LIMIT = 200;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const params = new URL(req.url).searchParams;
  const slug = params.get('survey');
  // No default survey here: this endpoint is new, so nothing depends on the
  // old implicit fallback, and an omitted slug is a caller bug worth surfacing.
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });

  const version = params.get('version');
  if (version !== null && (version.length === 0 || version.length > MAX_VERSION_CHARS)) {
    return new Response('invalid version', { status: 400 });
  }

  const scope = `survey_id=eq.${encodeURIComponent(slug)}`;

  if (version === null) {
    const res = await fetch(
      `${env.url}/rest/v1/survey_configs?${scope}&select=version,published_at` +
        `&order=published_at.desc&limit=${LIST_LIMIT}`,
      { headers },
    );
    if (!res.ok) return new Response('upstream error', { status: 502 });
    const versions = (await res.json()) as { version: string; published_at: string }[];
    return json({ versions });
  }

  // Scoped by survey as well as version: a version name carries its slug, but
  // the check belongs on the server, not in the name.
  const res = await fetch(
    `${env.url}/rest/v1/survey_configs?${scope}&version=eq.${encodeURIComponent(version)}` +
      '&select=version,published_at,config&limit=1',
    { headers },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });
  const rows = (await res.json()) as {
    version: string;
    published_at: string;
    config: unknown;
  }[];
  if (rows.length === 0) return new Response('version not found', { status: 404 });
  return json(rows[0]);
};
