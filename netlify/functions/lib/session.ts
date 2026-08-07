// סשן אדמין: עוגיית HMAC חתומה (בלי תלויות, node:crypto בלבד).
// כל פונקציית אדמין חייבת לקרוא requireAdmin לפני כל גישה ל-Supabase —
// זו נקודת האכיפה היחידה; כפתור הגוגל בדפדפן הוא UX בלבד.

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'sq_admin';
const MAX_AGE_S = 12 * 60 * 60; // 12 שעות

function hmac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function signSession(email: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + MAX_AGE_S * 1000 })).toString(
    'base64url',
  );
  return `${payload}.${hmac(payload, secret).toString('base64url')}`;
}

export function verifySession(token: string, secret: string): { email: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = hmac(payload, secret);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email: unknown;
      exp: unknown;
    };
    if (typeof email !== 'string' || typeof exp !== 'number' || Date.now() > exp) return null;
    return { email };
  } catch {
    return null;
  }
}

/** ערך Set-Cookie: קביעת סשן (token) או מחיקה (null). */
export function sessionCookie(token: string | null): string {
  const base = `${COOKIE_NAME}=${token ?? ''}; HttpOnly; Secure; SameSite=Strict; Path=/.netlify/functions`;
  return token ? `${base}; Max-Age=${MAX_AGE_S}` : `${base}; Max-Age=0`;
}

export function requireAdmin(req: Request): { email: string } | Response {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return new Response('server not configured', { status: 503 });
  const cookies = req.headers.get('cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  const session = match ? verifySession(match[1], secret) : null;
  if (!session) return new Response('unauthorized', { status: 401 });
  return session;
}
