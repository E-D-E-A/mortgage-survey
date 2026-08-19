// The MCP survey listing: exactly admin-surveys' GET (same join, same shape),
// behind the per-user read budget. Read-only by construction — the mutating
// methods of admin-surveys (create/rename/archive/delete) are deliberately not
// reachable from here: the MCP toolset has no survey-management verbs at all.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { enforceRateLimit } from './lib/mcp';
import { listSurveys } from './admin-surveys.mts';

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  if (req.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);

  const limited = await enforceRateLimit(env, session.email, 'read');
  if (limited) return limited;

  return listSurveys(env.url, supaHeaders(env.key));
};
