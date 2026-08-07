// פרסום הטיוטה כגרסה חדשה וקבועה. עורכי first-edea בלבד.
// שער הוולידציה האמיתי: אותו validateConfig שרץ בעורך רץ גם כאן —
// שגיאות חוסמות (422), אזהרות עוברות ומוחזרות למידע.
// POST { label? } → { version, warnings }

import { requireAdmin } from './lib/session';
import { validateConfig } from '../../src/engine/validate';
import type { SurveyConfig } from '../../src/engine/types';

const MAX_VERSION_CHARS = 100;

function supaHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export default async (req: Request): Promise<Response> => {
  const session = requireAdmin(req);
  if (session instanceof Response) return session;

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response('server not configured', { status: 503 });
  }

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

  const draftRes = await fetch(`${supaUrl}/rest/v1/survey_drafts?id=eq.1&select=config`, {
    headers: supaHeaders(supaKey),
  });
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
    return new Response(JSON.stringify({ errors, warnings }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // מספור גרסה: YYYY-MM-DD.N לפי הגרסאות הקיימות של אותו יום
  const date = new Date().toISOString().slice(0, 10);
  const existingRes = await fetch(
    `${supaUrl}/rest/v1/survey_configs?version=like.${encodeURIComponent(date)}*&select=version`,
    { headers: supaHeaders(supaKey) },
  );
  if (!existingRes.ok) return new Response('upstream error', { status: 502 });
  const existing = (await existingRes.json()) as { version: string }[];
  let n = 1;
  for (const row of existing) {
    const m = row.version.match(/^\d{4}-\d{2}-\d{2}\.(\d+)/);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }

  // ניסיון כפול: התנגשות PK (פרסום מקבילי) → נסיון אחד נוסף עם N+1
  for (let attempt = 0; attempt < 2; attempt++) {
    const version = `${date}.${n + attempt}${label ? `-${label}` : ''}`.slice(0, MAX_VERSION_CHARS);
    const published: SurveyConfig = { ...config, version };
    const res = await fetch(`${supaUrl}/rest/v1/survey_configs`, {
      method: 'POST',
      headers: { ...supaHeaders(supaKey), Prefer: 'return=minimal' },
      body: JSON.stringify({
        version,
        config: published,
        published_by: session.email,
      }),
    });
    if (res.ok) {
      return new Response(JSON.stringify({ version, warnings }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (res.status !== 409) return new Response('upstream error', { status: 502 });
  }
  return new Response('version conflict, try again', { status: 409 });
};
