// An in-memory stand-in for the admin API, faithful to mcp-draft.mts's
// semantics: optimistic locking, the validation gate, the code lock, and
// idempotency replay. It reuses the very modules the real endpoint runs
// (validateConfig, codeLockViolations), so the fake cannot drift from the
// server on the rules themselves — only the transport is faked. The real
// endpoint's behaviour against a real database is covered separately in
// tests/db/mcp-draft.test.ts.

import { validateConfig } from '../../src/engine/validate';
import { codeLockViolations } from '../../src/engine/lockedCodes';
import { starterConfig } from '../../src/questionnaire/starter';
import type { SurveyConfig } from '../../src/engine/types';
import type {
  ApiClient,
  ApiResult,
  AuditEntry,
  CreatedSurvey,
  DraftResponse,
  DraftWriteResult,
  PutDraftBody,
  SurveySummary,
} from '../../tools/mcp-server/src/api';

type Failure = { status: number; body: Record<string, unknown> };

export class FakeApi implements ApiClient {
  readonly drafts = new Map<string, { config: SurveyConfig | null; updated_at: string | null }>();
  /** Real names, for surveys created through createSurvey rather than seeded. */
  readonly names = new Map<string, string>();
  readonly published = new Map<string, { version: string; config: SurveyConfig }[]>();
  readonly audit: AuditEntry[] = [];
  private readonly idempotency = new Map<string, { status: number; response: { updated_at: string } }>();
  /** How many times a write actually executed — the double-apply detector */
  writesExecuted = 0;
  /** When set, the next call fails this way instead of (or after) executing */
  failNext: Failure | 'network' | 'network-after-write' | null = null;
  /**
   * Best-effort bookkeeping the endpoint could not complete — the audit row or
   * the idempotency key. The write itself succeeded, so these ride back on a
   * 200 as warnings rather than turning the call into a failure.
   */
  warnOnWrite: string[] | null = null;
  private tick = 0;

  private nowIso(): string {
    // Deterministic, strictly increasing timestamps — revision tokens the tests can compare
    return new Date(Date.UTC(2026, 7, 19, 12, 0, this.tick++)).toISOString();
  }

  seedDraft(slug: string, config: SurveyConfig | null): string | null {
    const updated_at = config ? this.nowIso() : null;
    this.drafts.set(slug, { config, updated_at });
    return updated_at;
  }

  seedPublished(slug: string, config: SurveyConfig, version = `2026-08-01.1-${slug}`): void {
    this.published.set(slug, [...(this.published.get(slug) ?? []), { version, config }]);
  }

  /** The warnings this write carries back, consumed so they apply once. */
  private takeWarnings(): { warnings?: string[] } {
    if (!this.warnOnWrite?.length) return {};
    return { warnings: this.warnOnWrite };
  }

  private takeFailure(): Failure | 'network' | null {
    if (this.failNext === null || this.failNext === 'network-after-write') return null;
    const f = this.failNext;
    this.failNext = null;
    return f;
  }

  async listSurveys(): Promise<ApiResult<{ surveys: SurveySummary[] }>> {
    const injected = this.takeFailure();
    if (injected === 'network') throw new Error('fetch failed');
    if (injected) return { ok: false, status: injected.status, body: injected.body };
    const surveys = [...this.drafts.entries()].map(([slug, draft]) => {
      const versions = this.published.get(slug) ?? [];
      return {
        slug,
        name: this.names.get(slug) ?? `שאלון ${slug}`,
        archived_at: null,
        has_draft: draft.config !== null,
        draft_updated_at: draft.updated_at,
        versions: versions.length,
        latest_version: versions.length > 0 ? versions[versions.length - 1].version : null,
      };
    });
    return { ok: true, data: { surveys } };
  }

  /**
   * Faithful to mcp-surveys.mts's POST: the slug is the primary key, so a
   * second create on the same slug is a 409 and not an overwrite — the case
   * that matters, because an agent that retries a create must not be able to
   * blank an existing survey's draft.
   */
  async createSurvey(slug: string, name: string): Promise<ApiResult<CreatedSurvey>> {
    const injected = this.takeFailure();
    if (injected === 'network') throw new Error('fetch failed');
    if (injected) return { ok: false, status: injected.status, body: injected.body };

    if (this.drafts.has(slug)) {
      return {
        ok: false,
        status: 409,
        body: { error: 'slug-exists', message: `כבר קיים שאלון עם המזהה "${slug}"` },
      };
    }

    const updated_at = this.nowIso();
    this.names.set(slug, name);
    this.drafts.set(slug, { config: starterConfig(name), updated_at });
    this.writesExecuted++;
    this.audit.push({
      user_email: 'fake@first-edea.com',
      survey_id: slug,
      revision_before: null,
      revision_after: updated_at,
      summary: `יצירת שאלון חדש "${name}" עם טיוטת שלד`,
      created_at: updated_at,
    });
    return {
      ok: true,
      data: { slug, name, draft_updated_at: updated_at, ...this.takeWarnings() },
    };
  }

  async getDraft(slug: string, includePublished: boolean): Promise<ApiResult<DraftResponse>> {
    const injected = this.takeFailure();
    if (injected === 'network') throw new Error('fetch failed');
    if (injected) return { ok: false, status: injected.status, body: injected.body };
    const draft = this.drafts.get(slug) ?? { config: null, updated_at: null };
    if (!includePublished) return { ok: true, data: { ...draft } };
    const versions = this.published.get(slug) ?? [];
    return {
      ok: true,
      data: {
        ...draft,
        published_versions: versions.length,
        latest_published: versions.length > 0 ? versions[versions.length - 1] : null,
      },
    };
  }

  async putDraft(slug: string, body: PutDraftBody): Promise<ApiResult<DraftWriteResult>> {
    const injected = this.takeFailure();
    if (injected === 'network') throw new Error('fetch failed');
    if (injected) return { ok: false, status: injected.status, body: injected.body };

    const replay = this.idempotency.get(body.idempotency_key);
    if (replay) return { ok: true, data: replay.response };

    const config = body.config as SurveyConfig;
    const issues = validateConfig(config);
    const errors = issues.filter((i) => i.level === 'error');
    const warnings = issues.filter((i) => i.level === 'warning');
    if (errors.length > 0) {
      return { ok: false, status: 422, body: { error: 'validation', errors, warnings } };
    }

    const versions = this.published.get(slug) ?? [];
    if (versions.length > 0) {
      const locked = codeLockViolations(versions[versions.length - 1].config, config);
      if (locked.length > 0) {
        return { ok: false, status: 409, body: { error: 'code-lock', locked } };
      }
    }

    const current = this.drafts.get(slug) ?? { config: null, updated_at: null };
    if (body.expected_updated_at !== current.updated_at) {
      return {
        ok: false,
        status: 409,
        body: { error: 'draft-conflict', current_updated_at: current.updated_at },
      };
    }

    const updated_at = this.nowIso();
    this.drafts.set(slug, { config, updated_at });
    this.writesExecuted++;
    this.audit.push({
      user_email: 'fake@first-edea.com',
      survey_id: slug,
      revision_before: body.expected_updated_at,
      revision_after: updated_at,
      summary: body.summary,
      created_at: updated_at,
    });
    const response = { updated_at };
    this.idempotency.set(body.idempotency_key, { status: 200, response });

    if (this.failNext === 'network-after-write') {
      // The write landed but the response never arrived — the retry-safety case
      this.failNext = null;
      throw new Error('socket hang up');
    }
    return { ok: true, data: { ...response, ...this.takeWarnings() } };
  }

  async getAudit(
    survey: string | null,
    limit: number,
  ): Promise<ApiResult<{ entries: AuditEntry[] }>> {
    const injected = this.takeFailure();
    if (injected === 'network') throw new Error('fetch failed');
    if (injected) return { ok: false, status: injected.status, body: injected.body };
    const entries = this.audit
      .filter((e) => survey === null || e.survey_id === survey)
      .slice(-limit)
      .reverse();
    return { ok: true, data: { entries } };
  }
}
