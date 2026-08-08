// פרסום טיוטת שאלון כגרסה חדשה וקבועה. עורכי first-edea בלבד.
// הפרמטר ?survey=<slug> בוחר את השאלון; בהיעדרו — שאלון ברירת המחדל.
// שער הוולידציה האמיתי: אותו validateConfig שרץ בעורך רץ גם כאן —
// שגיאות חוסמות (422), אזהרות עוברות ומוחזרות למידע.
// POST { label? } → { version, warnings }

import { requireAdmin } from './lib/session';
import { json, supaHeaders, supabaseEnv } from './lib/supabase';
import { DEFAULT_SURVEY_SLUG, isValidSlug } from '../../src/data/surveys';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';

const MAX_VERSION_CHARS = 100;

export default async (req: Request): Promise<Response> => {
  const session = await requireAdmin(req);
  if (session instanceof Response) return session;

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const env = supabaseEnv();
  if (env instanceof Response) return env;
  const headers = supaHeaders(env.key);

  const slug = new URL(req.url).searchParams.get('survey') ?? DEFAULT_SURVEY_SLUG;
  if (!isValidSlug(slug)) return new Response('invalid survey', { status: 400 });

  let label = '';
  try {
    const body = (await req.json()) as { label?: unknown };
    if (typeof body.label === 'string') {
      // תווית חופשית → סיומת בטוחה לגרסה (אותיות/ספרות/מקף בלבד)
      label = body.label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9֐-׾]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    }
  } catch {
    /* גוף ריק מותר */
  }

  const draftRes = await fetch(
    `${env.url}/rest/v1/survey_drafts?survey_id=eq.${encodeURIComponent(slug)}&select=config`,
    { headers },
  );
  if (!draftRes.ok) return new Response('upstream error', { status: 502 });
  const drafts = (await draftRes.json()) as { config: SurveyConfig }[];
  if (drafts.length === 0) {
    return new Response('no draft to publish', { status: 404 });
  }
  const config = drafts[0].config;

  const issues = validateConfig(config);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  if (errors.length > 0) {
    return json({ errors, warnings }, 422);
  }

  // מספור גרסה: YYYY-MM-DD.N-<slug> לפי גרסאות אותו שאלון באותו יום.
  // ה-slug הוא חלק מהמחרוזת ולכן version נשאר ייחודי גלובלית — וזה קריטי,
  // כי survey_events נושא רק survey_version בלי מזהה שאלון.
  const date = new Date().toISOString().slice(0, 10);
  const existingRes = await fetch(
    `${env.url}/rest/v1/survey_configs?survey_id=eq.${encodeURIComponent(slug)}` +
      `&version=like.${encodeURIComponent(date)}*&select=version`,
    { headers },
  );
  if (!existingRes.ok) return new Response('upstream error', { status: 502 });
  const existing = (await existingRes.json()) as { version: string }[];
  let n = 1;
  for (const row of existing) {
    const m = row.version.match(/^\d{4}-\d{2}-\d{2}\.(\d+)/);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }

  // ניסיון חוזר: התנגשות PK (פרסום מקבילי, או צירוף slug+label שכבר קיים)
  // → ניסיון נוסף עם N+1
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = `${date}.${n + attempt}-${slug}${label ? `-${label}` : ''}`.slice(
      0,
      MAX_VERSION_CHARS,
    );
    const published: SurveyConfig = { ...config, version };
    const res = await fetch(`${env.url}/rest/v1/survey_configs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        version,
        survey_id: slug,
        config: published,
        published_by: session.email,
      }),
    });
    if (res.ok) {
      return json({ version, warnings });
    }
    if (res.status !== 409) return new Response('upstream error', { status: 502 });
  }
  return new Response('version conflict, try again', { status: 409 });
};
