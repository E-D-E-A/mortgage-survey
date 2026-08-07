// אימות אדמין: מקבל ID token מ-Google Identity Services, מאמת אותו מול גוגל
// בצד השרת, ואוכף שהחשבון שייך לדומיין first-edea.com — רק אז נחתמת עוגיית סשן.
// POST { credential } → קביעת עוגייה | GET → מי מחובר | DELETE → יציאה

import { requireAdmin, sessionCookie, signSession } from './lib/session';

const ALLOWED_DOMAIN = 'first-edea.com';

interface TokenInfo {
  aud?: string;
  email?: string;
  email_verified?: string;
  hd?: string;
  exp?: string;
}

export default async (req: Request): Promise<Response> => {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!secret || !clientId) {
    return new Response('server not configured', { status: 503 });
  }

  if (req.method === 'GET') {
    const session = requireAdmin(req);
    if (session instanceof Response) return session;
    return new Response(JSON.stringify({ email: session.email }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'DELETE') {
    return new Response(null, { status: 204, headers: { 'Set-Cookie': sessionCookie(null) } });
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  let credential: unknown;
  try {
    ({ credential } = (await req.json()) as { credential?: unknown });
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > 8192) {
    return new Response('missing credential', { status: 400 });
  }

  // אימות ה-token מול גוגל (כולל בדיקת חתימה) — בצד השרת בלבד
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  );
  if (!res.ok) {
    return new Response('invalid token', { status: 403 });
  }
  const info = (await res.json()) as TokenInfo;

  const email = info.email ?? '';
  const valid =
    info.aud === clientId &&
    info.email_verified === 'true' &&
    // גם hd וגם סיומת המייל — hd חסר בחשבונות שאינם Workspace
    info.hd === ALLOWED_DOMAIN &&
    email.endsWith(`@${ALLOWED_DOMAIN}`) &&
    Number(info.exp) * 1000 > Date.now();

  if (!valid) {
    return new Response('forbidden: first-edea.com accounts only', { status: 403 });
  }

  return new Response(JSON.stringify({ email }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookie(signSession(email, secret)),
    },
  });
};
