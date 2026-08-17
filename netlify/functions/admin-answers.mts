// Paging through the open-text answers — read-only, first-edea editors only
// (requireAdmin). The browser tells us which screens are text questions (the
// config lives there); here we only filter, measure lengths and page. No content
// analysis whatsoever — the text comes back exactly as written.
//
//   GET ?survey=<slug>&screens=<id,id,...>&version=<version|all>
//       &dim=<session var>&value=<value|__unknown__>
//       &include_test=<1|0>&limit=<1..100>&offset=<n>
//     → { stats: [...], total, rows: [{ screen_id, value, created_at, survey_version, dim_value, outcome }] }
//
// Always fresh (no-store). ⚠ The rpc names are kept in sync with schema.sql (tests/sync).

import { requireAdmin } from './lib/session';
import { json, rpc, supaHeaders, supabaseEnv } from './lib/supabase';
import { isValidSlug } from '../../src/data/surveys';

const NO_STORE = { 'Cache-Control': 'no-store' };
const SCREEN_ID_RE = /^[\w-]{1,200}$/;
const MAX_SCREENS = 50;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;
const MAX_VALUE_CHARS = 200;
// The same shape admin-stats accepts for its breakdown dimension
const DIM_RE = /^[A-Za-z0-9_]{1,64}$/;

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

  const screens = (params.get('screens') ?? '').split(',').filter((s) => s.length > 0);
  if (
    screens.length === 0 ||
    screens.length > MAX_SCREENS ||
    screens.some((s) => !SCREEN_ID_RE.test(s))
  ) {
    return new Response('invalid screens', { status: 400 });
  }

  const includeTest = params.get('include_test') === '1';
  const versionParam = params.get('version') ?? 'all';
  // Which session variable to report and filter by. Hardcoding 'segment' here
  // meant the filter silently did nothing on every survey built in the console,
  // where the marks are named mark1, mark2…
  const dim = params.get('dim');
  if (dim !== null && !DIM_RE.test(dim)) {
    return new Response('invalid dim', { status: 400 });
  }
  const value = params.get('value');
  if (value !== null && (value.length === 0 || value.length > MAX_VALUE_CHARS)) {
    return new Response('invalid value', { status: 400 });
  }

  const limit = parseIntParam(params.get('limit'), DEFAULT_LIMIT);
  const offset = parseIntParam(params.get('offset'), 0);
  if (limit === null || limit < 1 || limit > MAX_LIMIT) return new Response('invalid limit', { status: 400 });
  if (offset === null || offset < 0 || offset > MAX_OFFSET) return new Response('invalid offset', { status: 400 });

  const slug = encodeURIComponent(survey);
  const [surveyRes, versionsRes] = await Promise.all([
    fetch(`${env.url}/rest/v1/surveys?slug=eq.${slug}&select=slug`, { headers }),
    fetch(`${env.url}/rest/v1/survey_configs?survey_id=eq.${slug}&select=version`, { headers }),
  ]);
  if (!surveyRes.ok || !versionsRes.ok) return new Response('upstream error', { status: 502 });
  if (((await surveyRes.json()) as unknown[]).length === 0) {
    return new Response('survey not found', { status: 404 });
  }
  const versions = (await versionsRes.json()) as { version: string }[];
  const version = versionParam === 'all' ? null : versionParam;
  if (version !== null && !versions.some((v) => v.version === version)) {
    return new Response('unknown version', { status: 400 });
  }

  const common = { p_survey: survey, p_version: version, p_include_test: includeTest };
  const [statsRows, answerRows] = await Promise.all([
    rpc(env, 'open_answer_stats', { ...common, p_screen: null }),
    rpc(env, 'open_answers', {
      ...common,
      p_screens: screens,
      p_dim: dim,
      p_value: value,
      p_limit: limit,
      p_offset: offset,
    }),
  ]);
  if (statsRows instanceof Response) return statsRows;
  if (answerRows instanceof Response) return answerRows;

  const requested = new Set(screens);
  const rows = (answerRows as ({ total: number | string } & Record<string, unknown>)[]).map(
    ({ total: _total, ...row }) => row,
  );
  const total = (answerRows as { total: number | string }[])[0]?.total ?? 0;

  return json(
    {
      // Metadata only for the screens that were asked for — the rpc returns them all and filtering here is cheaper
      stats: (statsRows as { screen_id: string }[]).filter((s) => requested.has(s.screen_id)),
      total: Number(total),
      rows,
    },
    200,
    NO_STORE,
  );
};

function parseIntParam(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d{1,6}$/.test(raw)) return null;
  return Number(raw);
}
