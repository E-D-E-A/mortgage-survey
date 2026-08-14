// A survey's quota state: how many respondents have already finished with each
// value that carries a ceiling. A public endpoint with no authentication, like
// config-get — the respondent calls it on entry, before any session exists. The
// service_role key stays server-side and is never sent to the client.
//
// The comparison against the ceiling happens in the browser and not here, on
// purpose: a respondent's config is pinned to the version they started on
// (config-get), and the ceilings that apply to them are the ones in their
// version — not the ones in whatever has been published since.
//
// ⚠ What is exposed here is cumulative counts for values that have a quota
// defined, and nothing more: there is no free-form mark list and no access to a
// session's vars. The ceilings themselves are public anyway — they are part of
// the config config-get serves to every respondent.
//
// Any failure here comes back as an error, and the client carries on as if no
// quota were full (fail open): a fault of ours does not block real respondents.
//
//   GET ?survey=<slug> → { survey, version, counts: { <mark>: { <value>: n } } }

import { json, rpc, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';
import { quotaCells } from '../../src/engine/quota';
import type { SurveyConfig } from '../../src/engine/types';

interface CountRow {
  mark: string;
  value: string | null;
  n: number;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });

  // The active version is what decides which marks are counted at all. A survey
  // that has never been published is not an error here — it simply has no quotas.
  const res = await fetch(
    `${env.url}/rest/v1/survey_configs?survey_id=eq.${encodeURIComponent(slug)}` +
      `&select=version,config&order=published_at.desc&limit=1`,
    { headers: supaHeaders(env.key) },
  );
  if (!res.ok) return new Response('upstream error', { status: 502 });

  const rows = (await res.json()) as { version: string; config: SurveyConfig }[];
  if (rows.length === 0) return quotaResponse(slug, null, {});

  const { version, config } = rows[0];
  const marks = [...new Set(quotaCells(config).map((cell) => cell.mark))];
  if (marks.length === 0) return quotaResponse(slug, version, {});

  const counted = await rpc(env, 'quota_counts', { p_survey: slug, p_marks: marks });
  if (counted instanceof Response) return counted;

  const counts: Record<string, Record<string, number>> = {};
  for (const row of counted as CountRow[]) {
    // A null value = a session that finished without this mark at all; it has no cell to count into
    if (row.value === null) continue;
    (counts[row.mark] ??= {})[row.value] = row.n;
  }
  return quotaResponse(slug, version, counts);
};

function quotaResponse(
  survey: string,
  version: string | null,
  counts: Record<string, Record<string, number>>,
): Response {
  return json({ survey, version, counts }, 200, {
    // A minute of cache: the count is approximate anyway (see engine/quota.ts),
    // and this endpoint is called on every entry to the survey — including a
    // traffic spike that all arrives from the same distribution push.
    'Cache-Control': 'public, max-age=60, must-revalidate',
  });
}
