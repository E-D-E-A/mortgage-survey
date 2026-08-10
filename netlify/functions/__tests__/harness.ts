// רתמה משותפת לבדיקות הפונקציות: מחליפה את PostgREST ואת Supabase Auth
// בנתב מקומי, ומתעדת כל בקשה שיוצאת. כך אפשר לבדוק את הדבר שחשוב באמת —
// *איזו שאילתה* נשלחה ו*מה* נכתב — ולא רק את קוד התשובה.
//
// הקובץ הזה אינו בדיקה בעצמו (אין לו סיומת .test.ts), ולכן vitest לא אוסף אותו.

import { expect, vi } from 'vitest';

export const SUPA_URL = 'https://project.supabase.co';
export const SERVICE_KEY = 'service-role-secret';
export const ADMIN_EMAIL = 'editor@first-edea.com';

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Route {
  /** תבנית שמזוהה מול ה-URL המלא (אחרי SUPA_URL) */
  match: RegExp;
  method?: string;
  status?: number;
  /** סדרת קודים לבקשות עוקבות (למשל 409 ואז 201, כדי לבדוק ניסיון חוזר) */
  statuses?: number[];
  /** גוף התשובה; מערך ריק הוא "לא נמצא" בשפת PostgREST */
  body?: unknown;
  /** טקסט גולמי (למשל הודעת שגיאה של PostgREST עם שם ה-constraint) */
  text?: string;
}

export interface Harness {
  calls: Call[];
  /** מוסיף מסלול בראש התור — מנצח מסלולים שהוגדרו קודם */
  on(route: Route): void;
  /** הבקשות שיצאו אל טבלה מסוימת */
  to(table: string): Call[];
}

/**
 * ⚠ המשתמש שמוחזר מ-‎/auth/v1/user‎ הוא ברירת המחדל של הרתמה: עורך תקין
 * מהדומיין המורשה, עם זהות Google ומייל מאומת. בדיקה שרוצה משתמש אחר
 * דוחפת מסלול משלה עם harness.on(...).
 */
export const VALID_USER = {
  email: ADMIN_EMAIL,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'google', providers: ['google'] },
};

export function installHarness(routes: Route[] = []): Harness {
  const calls: Call[] = [];
  const table: Route[] = [
    { match: /\/auth\/v1\/user/, body: VALID_USER },
    ...routes,
  ];

  vi.stubEnv('SUPABASE_URL', SUPA_URL);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);

  globalThis.fetch = vi.fn(async (url: unknown, init?: unknown) => {
    const request = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
    const method = request.method ?? 'GET';
    const full = String(url);
    calls.push({
      url: full,
      method,
      headers: request.headers ?? {},
      body: request.body ? JSON.parse(request.body) : undefined,
    });
    const route = table.find((r) => r.match.test(full) && (!r.method || r.method === method));
    if (!route) throw new Error(`no route for ${method} ${full}`);
    const status =
      route.statuses && route.statuses.length > 0 ? route.statuses.shift()! : (route.status ?? 200);
    const text = route.text ?? JSON.stringify(route.body ?? []);
    return {
      ok: status < 400,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as Response;
  }) as unknown as typeof fetch;

  return {
    calls,
    on: (route: Route) => table.unshift(route),
    to: (name: string) => calls.filter((c) => c.url.includes(`/rest/v1/${name}`)),
  };
}

/** בקשה מאומתת אל פונקציית אדמין. */
export function adminRequest(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Request {
  const { token = 'valid-access-token', ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (rest.body) headers['Content-Type'] = 'application/json';
  return new Request(`https://site.example/.netlify/functions/${path}`, { ...rest, headers });
}

/** שום בקשת אדמין לא נשענת על הדפדפן: אין טוקן ⇒ 401, ואפס גישה ל-DB. */
export async function expectAuthGate(
  handler: (req: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
): Promise<void> {
  const noToken = installHarness();
  expect((await handler(adminRequest(path, { ...init, token: null }))).status).toBe(401);
  expect(noToken.calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);

  const rejected = installHarness();
  rejected.on({ match: /\/auth\/v1\/user/, status: 401, text: 'bad jwt' });
  expect((await handler(adminRequest(path, init))).status).toBe(401);
  expect(rejected.calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);

  const outsider = installHarness();
  outsider.on({
    match: /\/auth\/v1\/user/,
    body: { ...VALID_USER, email: 'someone@gmail.com' },
  });
  expect((await handler(adminRequest(path, init))).status).toBe(403);
  expect(outsider.calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);
}
