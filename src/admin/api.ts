// שכבת הגישה של קונסולת הניהול לפונקציות ה-Netlify.
// כל הקריאות עם credentials — עוגיית הסשן (HttpOnly) נשלחת אוטומטית.

import type { SurveyConfig } from '../engine/types';
import type { ValidationIssue } from '../engine/validate';

export class UnauthorizedError extends Error {}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/.netlify/functions/${path}`, {
    credentials: 'same-origin',
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError();
  return res;
}

export async function getSession(): Promise<{ email: string } | null> {
  try {
    const res = await call('admin-auth');
    if (!res.ok) return null;
    return (await res.json()) as { email: string };
  } catch {
    return null;
  }
}

export async function login(credential: string): Promise<{ email: string }> {
  const res = await call('admin-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (res.status === 403) throw new Error('forbidden');
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()) as { email: string };
}

export async function logout(): Promise<void> {
  await call('admin-auth', { method: 'DELETE' });
}

export interface DraftData {
  config: SurveyConfig | null;
  updated_at: string | null;
}

export async function getDraft(): Promise<DraftData> {
  const res = await call('admin-draft');
  if (!res.ok) throw new Error(`draft load failed: ${res.status}`);
  return (await res.json()) as DraftData;
}

export class ConflictError extends Error {}

export async function saveDraft(
  config: SurveyConfig,
  expectedUpdatedAt: string | null,
): Promise<{ updated_at: string }> {
  const res = await call('admin-draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, expected_updated_at: expectedUpdatedAt }),
  });
  if (res.status === 409) throw new ConflictError();
  if (!res.ok) throw new Error(`draft save failed: ${res.status}`);
  return (await res.json()) as { updated_at: string };
}

export interface PublishResult {
  version?: string;
  warnings?: ValidationIssue[];
  errors?: ValidationIssue[];
}

export async function publish(label: string): Promise<{ status: number; data: PublishResult }> {
  const res = await call('admin-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const data = res.status === 200 || res.status === 422 ? ((await res.json()) as PublishResult) : {};
  return { status: res.status, data };
}
