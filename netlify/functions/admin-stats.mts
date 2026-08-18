// Response statistics for the console — read-only, first-edea editors only.
// This is the first read path from the browser to answer data: requireAdmin
// before anything else, and the browser still never touches Supabase — it all
// goes through here with service_role on the server side.
//
//   GET ?survey=<slug>&version=<version|all>&include_test=<1|0>&by=<var|_outcome>
//     → { survey, name,
//         versions: [{ version, published_at, config }],   ← the configs, decoded in the browser
//         overview, funnel, distributions,                 ← see the functions in schema.sql
//         by,                                              ← the dimension returned, or null
//         bases }                                          ← the denominators for the breakdown percentages
//
// Always fresh (Cache-Control: no-store) — live tracking of the field matters
// more than caching.
// ⚠ The rpc names are kept in sync with schema.sql — enforced by
// tests/sync/stats-sql.test.ts.

import { requireAdmin } from './lib/session';
import { json, rpc, supaHeaders, supabaseEnv } from './lib/supabase';
import { isValidSlug } from '../../src/data/surveys';
import type { SurveyConfig } from '../../src/engine/types';
import { dimensionOptions } from '../../src/admin/dimensions';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface VersionRow {
  version: string;
  published_at: string;
  config: SurveyConfig;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });

  const session = await requireAdmin(req);
  if (session instanceof Response) return session;
  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const params = new URL(req.url).searchParams;
  const survey = params.get('survey') ?? '';
  if (!isValidSlug(survey)) return new Response('invalid survey', { status: 400 });
  const includeTest = params.get('include_test') === '1';
  const versionParam = params.get('version') ?? 'all';
  // The breakdown dimension: a session variable name, or `_outcome` for the session's outcome (see schema.sql)
  const by = params.get('by');
  if (by !== null && !/^[A-Za-z0-9_]{1,64}$/.test(by)) {
    return new Response('invalid by', { status: 400 });
  }

  const slug = encodeURIComponent(survey);
  // The configs travel with the bundle: wording, screen order and labels are all resolved in the browser
  const [surveyRes, versionsRes] = await Promise.all([
    fetch(`${env.url}/rest/v1/surveys?slug=eq.${slug}&select=slug,name`, { headers }),
    fetch(
      `${env.url}/rest/v1/survey_configs?survey_id=eq.${slug}&select=version,published_at,config&order=published_at.desc,version.desc`,
      { headers },
    ),
  ]);
  if (!surveyRes.ok || !versionsRes.ok) return new Response('upstream error', { status: 502 });

  const surveyRows = (await surveyRes.json()) as { slug: string; name: string }[];
  if (surveyRows.length === 0) return new Response('survey not found', { status: 404 });
  const versions = (await versionsRes.json()) as VersionRow[];

  // version=all → null in the SQL functions (all versions); an explicit version has to exist
  const version = versionParam === 'all' ? null : versionParam;
  if (version !== null && !versions.some((v) => v.version === version)) {
    return new Response('unknown version', { status: 400 });
  }

  // The dimension has to be one the console actually offers. The pattern above
  // only says the name is well formed; on its own it would let an authenticated
  // caller break the sample down by any session variable the survey happens to
  // carry — a panel id, say. "The offered dimensions and nothing else" is a rule
  // of the feature, so it is enforced here rather than only by the dropdown that
  // draws the menu, and from the same function the dropdown is drawn from.
  if (by !== null && !dimensionOptions(versions, versionParam).some((d) => d.key === by)) {
    return new Response('unknown dimension', { status: 400 });
  }

  const rpcArgs = { p_survey: survey, p_version: version, p_include_test: includeTest };
  const [overviewRows, funnelRows, distRows, baseRows] = await Promise.all([
    rpc(env, 'stats_overview', rpcArgs),
    rpc(env, 'stats_funnel', rpcArgs),
    rpc(env, 'stats_distributions', { ...rpcArgs, p_by: by }),
    by === null ? Promise.resolve([]) : rpc(env, 'stats_bases', { ...rpcArgs, p_by: by }),
  ]);
  if (overviewRows instanceof Response) return overviewRows;
  if (funnelRows instanceof Response) return funnelRows;
  if (distRows instanceof Response) return distRows;
  if (baseRows instanceof Response) return baseRows;

  return json(
    {
      survey,
      name: surveyRows[0].name,
      versions,
      overview: (overviewRows as Record<string, number>[])[0],
      funnel: funnelRows,
      distributions: distRows,
      by,
      bases: baseRows,
    },
    200,
    NO_STORE,
  );
};
