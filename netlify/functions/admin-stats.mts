// סטטיסטיקות תגובות לקונסולה — קריאה בלבד, עורכי first-edea בלבד.
// זהו נתיב הקריאה-מהדפדפן הראשון לנתוני תשובות: requireAdmin לפני הכל,
// והדפדפן עדיין לא נוגע ב-Supabase — הכל דרך כאן עם service_role בצד השרת.
//
//   GET ?survey=<slug>&version=<version|all>&include_test=<1|0>&by=<var|_outcome>
//     → { survey, name,
//         versions: [{ version, published_at, config }],   ← הקונפיגים לפענוח בדפדפן
//         overview, funnel, distributions,                 ← ראו הפונקציות ב-schema.sql
//         by,                                              ← המימד שהוחזר, או null
//         bases }                                          ← מכני אחוזים לפילוח
//
// טרי תמיד (Cache-Control: no-store) — מעקב חי אחרי שטח חשוב מקאש.
// ⚠ שמות ה-rpc מסונכרנים עם schema.sql — נאכף ב-tests/sync/stats-sql.test.ts.

import { requireAdmin } from './lib/session';
import { json, rpc, supaHeaders, supabaseEnv } from './lib/supabase';
import { isValidSlug } from '../../src/data/surveys';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface VersionRow {
  version: string;
  published_at: string;
  config: unknown;
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
  // מימד פילוח: שם משתנה סשן, או ‎_outcome‎ לתוצאת הסשן (ראו schema.sql)
  const by = params.get('by');
  if (by !== null && !/^[A-Za-z0-9_]{1,64}$/.test(by)) {
    return new Response('invalid by', { status: 400 });
  }

  const slug = encodeURIComponent(survey);
  // הקונפיגים נוסעים עם הצרור: פענוח נוסחים, סדר מסכים ותוויות נעשה בדפדפן
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

  // version=all → null בפונקציות ה-SQL (כל הגרסאות); גרסה מפורשת חייבת להתקיים
  const version = versionParam === 'all' ? null : versionParam;
  if (version !== null && !versions.some((v) => v.version === version)) {
    return new Response('unknown version', { status: 400 });
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
