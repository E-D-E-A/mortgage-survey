// The typed client for the app's own Netlify admin functions — the only
// network destination this server has. Every call carries the teammate's own
// Supabase access token as a Bearer header; there is no other credential in
// the process, and no tool argument can inject one.
//
// The interface exists for the tests: the MCP integration suite plugs in a
// fake ApiClient and exercises every tool without a network or a login.

import type { SurveyConfig } from '../../../src/engine/types';
import type { ValidationIssue } from '../../../src/engine/validate';
import type { CodeLockViolation } from '../../../src/engine/lockedCodes';

export interface SurveySummary {
  slug: string;
  name: string;
  archived_at: string | null;
  has_draft: boolean;
  draft_updated_at: string | null;
  versions: number;
  latest_version: string | null;
}

export interface DraftResponse {
  config: SurveyConfig | null;
  updated_at: string | null;
  /** Present when the published side was requested */
  published_versions?: number;
  latest_published?: { version: string; config: SurveyConfig } | null;
}

export interface PutDraftBody {
  config: unknown;
  expected_updated_at: string | null;
  idempotency_key: string;
  summary: string;
}

export interface AuditEntry {
  user_email: string;
  survey_id: string;
  revision_before: string | null;
  revision_after: string;
  summary: string;
  created_at: string;
}

/** A failed call, with whatever structured body the server sent. */
export interface ApiFailure {
  ok: false;
  status: number;
  body: {
    error?: string;
    message?: string;
    retry_after_seconds?: number;
    current_updated_at?: string | null;
    errors?: ValidationIssue[];
    warnings?: ValidationIssue[];
    locked?: CodeLockViolation[];
    [key: string]: unknown;
  };
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export interface ApiClient {
  listSurveys(): Promise<ApiResult<{ surveys: SurveySummary[] }>>;
  getDraft(slug: string, includePublished: boolean): Promise<ApiResult<DraftResponse>>;
  putDraft(slug: string, body: PutDraftBody): Promise<ApiResult<{ updated_at: string }>>;
  getAudit(survey: string | null, limit: number): Promise<ApiResult<{ entries: AuditEntry[] }>>;
}

/** Supplies a valid access token, running the browser login when needed. */
export type TokenSource = () => Promise<string>;

export class HttpApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenSource,
    /**
     * Called on a 401 so the auth layer can drop its cached session — the
     * tool's error text promises the NEXT call opens a fresh browser login,
     * and without this hook a still-unexpired-but-revoked token would keep
     * being replayed until it aged out.
     */
    private readonly onUnauthorized: () => Promise<void> = async () => {},
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    const token = await this.token();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/.netlify/functions/${path}`, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      // Name the destination: "fetch failed" alone reads like a server bug,
      // when nine times out of ten it is SURVEY_API_URL pointing at a
      // netlify dev that is not running (the localhost default).
      throw new Error(
        `cannot reach ${this.baseUrl} (${(err as Error).message}) — ` +
          'check SURVEY_API_URL: unset means the local netlify dev at localhost:8888',
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      body = { message: text };
    }
    if (!res.ok) {
      if (res.status === 401) await this.onUnauthorized().catch(() => {});
      return { ok: false, status: res.status, body: body as ApiFailure['body'] };
    }
    return { ok: true, data: body as T };
  }

  listSurveys(): Promise<ApiResult<{ surveys: SurveySummary[] }>> {
    return this.call('mcp-surveys');
  }

  getDraft(slug: string, includePublished: boolean): Promise<ApiResult<DraftResponse>> {
    const include = includePublished ? '&include=published' : '';
    return this.call(`mcp-draft?survey=${encodeURIComponent(slug)}${include}`);
  }

  putDraft(slug: string, body: PutDraftBody): Promise<ApiResult<{ updated_at: string }>> {
    return this.call(`mcp-draft?survey=${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  getAudit(survey: string | null, limit: number): Promise<ApiResult<{ entries: AuditEntry[] }>> {
    const scope = survey ? `survey=${encodeURIComponent(survey)}&` : '';
    return this.call(`mcp-audit?${scope}limit=${limit}`);
  }
}
