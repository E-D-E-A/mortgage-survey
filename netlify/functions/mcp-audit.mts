// Reading the MCP audit log: who changed what, when, through the agent path.
// first-edea editors only, behind the read budget. Read-only — the log itself
// is written exclusively by mcp-draft.mts on an executed write.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv, upstreamFailure } from './lib/supabase';
import { enforceRateLimit } from './lib/mcp';
import { isValidSlug } from '../../src/data/surveys';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  if (req.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);

  const limited = await enforceRateLimit(env, session.email, 'read');
  if (limited) return limited;

  const params = new URL(req.url).searchParams;
  const survey = params.get('survey');
  if (survey !== null && !isValidSlug(survey)) {
    return json({ error: 'invalid-survey', message: 'מזהה השאלון אינו תקין' }, 400);
  }
  const rawLimit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const filters = [
    survey ? `survey_id=eq.${encodeURIComponent(survey)}` : null,
    `order=created_at.desc`,
    `limit=${limit}`,
    `select=user_email,survey_id,revision_before,revision_after,summary,created_at`,
  ]
    .filter(Boolean)
    .join('&');

  const res = await fetch(`${env.url}/rest/v1/mcp_audit_log?${filters}`, {
    headers: supaHeaders(env.key),
  });
  if (!res.ok) return upstreamFailure(res, 'table', 'mcp_audit_log');
  return json({ entries: await res.json() });
};
