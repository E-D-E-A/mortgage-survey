// The MCP survey endpoint:
//   GET                 → exactly admin-surveys' GET (same join, same shape), behind the read budget
//   POST { slug, name } → a new survey plus a skeleton draft, behind the write budget
//
// Creation is the one survey-management verb reachable from MCP, and it is here
// so a questionnaire can be built end to end from a chat instead of starting
// with a manual step in the console. Rename, archive and delete stay
// console-only: they act on surveys that may already carry published versions
// and respondent events, so they remain human decisions in /admin.
//
// The creation path is metered against the WRITE budget, not the read one — it
// inserts rows, and an agent loop that creates surveys is exactly what that
// budget exists to stop.

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv, type SupabaseEnv } from './lib/supabase';
import { enforceRateLimit, recordAudit } from './lib/mcp';
import { cleanName, createSurveyRecord, listSurveys } from './admin-surveys.mts';
import { isValidSlug } from '../../src/data/surveys';

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  const env = supabaseEnv();
  if (env instanceof Response) return env;

  if (req.method === 'GET') {
    const limited = await enforceRateLimit(env, session.email, 'read');
    if (limited) return limited;
    return listSurveys(env.url, supaHeaders(env.key));
  }

  if (req.method === 'POST') return createSurvey(req, env, session.email);

  return json({ error: 'method-not-allowed' }, 405);
};

async function createSurvey(req: Request, env: SupabaseEnv, email: string): Promise<Response> {
  const limited = await enforceRateLimit(env, email, 'write');
  if (limited) return limited;

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json({ error: 'invalid-json', message: 'גוף הבקשה אינו JSON תקין' }, 400);
  }
  const body = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;

  const slug = body.slug;
  const name = cleanName(body.name);
  if (!isValidSlug(slug)) {
    return json(
      {
        error: 'invalid-slug',
        message: 'מזהה השאלון חייב להיות אותיות אנגליות קטנות, ספרות ומקפים',
      },
      400,
    );
  }
  if (!name) {
    return json({ error: 'invalid-name', message: 'שם השאלון חסר' }, 400);
  }

  const created = await createSurveyRecord(env.url, supaHeaders(env.key), email, slug, name);
  if (!created.ok) {
    if (created.status === 409) {
      return json(
        { error: 'slug-exists', message: `כבר קיים שאלון עם המזהה "${slug}"` },
        409,
      );
    }
    return new Response('upstream error', { status: 502 });
  }

  // Creation is an MCP write, so it belongs in the same log as every draft
  // write — otherwise a survey appears in the console with no record of who
  // brought it into being. revision_before is null: there was no revision.
  //
  // The log is best-effort (the survey exists either way), but not silent: a
  // failure comes back as a warning on the successful answer, so an unlogged
  // creation is visible to the caller rather than only in the database logs.
  const auditNote = await recordAudit(env, {
    user_email: email,
    survey_id: slug,
    revision_before: null,
    revision_after: created.draftUpdatedAt,
    summary: `יצירת שאלון חדש "${name}" עם טיוטת שלד`,
  });

  const result = { slug, name, draft_updated_at: created.draftUpdatedAt };
  return json(auditNote ? { ...result, warnings: [auditNote] } : result);
}
