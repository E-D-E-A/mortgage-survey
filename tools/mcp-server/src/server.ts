// The MCP server: six small tools over the admin API, shaped for the
// propose→confirm→apply flow. Deliberately absent: publish, archive, delete —
// not blocked, but unbuildable from here; no code path in this package or in
// the endpoints it calls can reach survey_configs or survey rows. Publishing
// stays a human action in /admin.
//
// The server is constructed around an injected ApiClient so the integration
// tests can drive every tool — full flows and every edge case — through the
// SDK's in-memory transport with no network and no login.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { validateConfig } from '../../../src/engine/validate';
import { codeLockViolations } from '../../../src/engine/lockedCodes';
import { simulatePath } from '../../../src/engine/path';
import { quotaFullVar } from '../../../src/engine/quota';
import { screenKindLabel, screenLabel } from '../../../src/admin/display';
import type { Answers, SurveyConfig, Vars } from '../../../src/engine/types';
import type { ApiClient, ApiFailure } from './api';
import { AuthRequiredError } from './auth';
import { buildOutline } from '../../../src/admin/outline';
import { diffConfigs, renderDiff } from '../../../src/admin/diff';
import { ProposalStore } from './proposals';
import { configSchema, quotaCellsSchema, seedVarsSchema, slugSchema, summarySchema } from './schema';

/** Above this size get_draft returns the outline only, unless full JSON is asked for. */
const INLINE_CONFIG_LIMIT_CHARS = 60_000;

const INSTRUCTIONS = `Survey draft editor for the mortgage-survey admin system. All survey content and all
user-facing messages are Hebrew. Follow this workflow strictly:

1. Always call get_draft first and work from the CURRENT draft state — never from memory
   of an earlier call.
2. When the user's persona criteria, conditions, or routing are ambiguous, ask the user
   clarifying questions BEFORE proposing a change. Do not guess thresholds, values, or
   screen wording.
3. propose_change is a dry run: nothing is written. ALWAYS show the returned diff and
   validation results to the user and get their explicit confirmation before calling
   apply_change. Never chain propose_change into apply_change without a human in between.
4. apply_change applies exactly the proposed config (hash-verified), with optimistic
   locking. After a successful apply, run simulate_path for each persona or path the
   change affects and report the resulting screen sequences to the user.
5. Drafts only: this server cannot publish, archive, or delete surveys — those are human
   actions in the /admin console. After applying, remind the user to review the draft in
   /admin and publish it themselves.

Error handling: on a draft conflict (someone saved concurrently), re-fetch with get_draft
and re-propose — never merge blindly. On a code-lock rejection, explain that analysis
codes are frozen once a survey has been published, because collected answers reference
them. On a rate limit, stop and tell the user when to try again — do not retry in a loop.`;

const jsonBlock = (value: unknown): string => JSON.stringify(value, null, 2);

const textResult = (text: string, structured: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structured,
});

const errorResult = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

/**
 * The config argument, as an object, whatever shape it arrived in.
 *
 * It is declared `z.unknown()` so the SDK hands it over untouched (see the
 * comment on propose_change's inputSchema). The cost of an untyped parameter
 * is that its JSON Schema carries no `type`, and a client that decides how to
 * serialise an argument from its declared type sends the config as JSON *text*
 * instead of as an object — every propose then dies on "(root): Expected
 * object, received string" with nothing the caller can do about it.
 *
 * Parsing that text here is not a second interpretation of the config: it is
 * the same bytes the client composed, and JSON.parse preserves their key
 * order, so the byte-identical round-trip the opacity exists to protect still
 * holds.
 */
function configAsObject(value: unknown): { ok: true; config: unknown } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: true, config: value };
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error:
          'The config arrived as JSON text that does not describe an object. הקונפיג חייב להיות אובייקט JSON מלא.',
      };
    }
    return { ok: true, config: parsed };
  } catch (e) {
    return {
      ok: false,
      error:
        'The config arrived as text that is not valid JSON: ' +
        (e instanceof Error ? e.message : String(e)) +
        '\nהקונפיג הגיע כמחרוזת שאינה JSON תקין.',
    };
  }
}

/** A failed admin-API call, translated into guidance the model can act on. */
function failureResult(f: ApiFailure): CallToolResult {
  const detail = jsonBlock(f.body);
  if (f.status === 401) {
    return errorResult(
      `Authentication expired or revoked (401). ההתחברות פגה או בוטלה — הקריאה הבאה לכל כלי תפתח דפדפן להתחברות מחדש עם חשבון first-edea.com. אין ולא יהיה שימוש בהרשאה משותפת.\n${detail}`,
    );
  }
  if (f.status === 403) {
    return errorResult(
      `Forbidden (403). החשבון המחובר אינו מורשה — נדרש חשבון Google בדומיין first-edea.com.\n${detail}`,
    );
  }
  if (f.status === 429) {
    const wait = f.body.retry_after_seconds ?? 3600;
    return errorResult(
      `Rate limit reached (429). STOP — do not retry in a loop. חריגה ממכסת הבקשות; יש להמתין ${wait} שניות ולעדכן את המשתמש.\n${detail}`,
    );
  }
  if (f.status === 409 && f.body.error === 'draft-conflict') {
    return errorResult(
      `Draft changed concurrently (409). הטיוטה נשמרה בינתיים על ידי מישהו אחר (כנראה בקונסולה). קראו get_draft מחדש, בנו את השינוי מעל המצב העדכני והציעו מחדש — לעולם אל תמזגו על עיוור.\n${detail}`,
    );
  }
  if (f.status === 409 && f.body.error === 'code-lock') {
    const names = (f.body.locked ?? []).map((v) => (v.value ? `${v.name}=${v.value}` : v.name));
    return errorResult(
      `Code lock (409). קודי אנליזה נעולים: ${names.join(', ')}. מהפרסום הראשון של שאלון אסור לשנות או למחוק קוד של סימון, הגרלה או ערך — תשובות שכבר נאספו רשומות תחת הקודים האלה, ושינוי היה מנתק אותן. אפשר להוסיף קודים חדשים; אי אפשר לשנות קיימים.\n${detail}`,
    );
  }
  if (f.status === 422) {
    return errorResult(
      `Validation failed server-side (422) — the full issue list follows; fix and re-propose.\n${detail}`,
    );
  }
  if (f.status === 413) {
    return errorResult(
      `Config too large (413). הקונפיג חורג מ־500KB ולא נשמר — יש לצמצם.\n${detail}`,
    );
  }
  return errorResult(`Admin API call failed with status ${f.status}.\n${detail}`);
}

/** Wraps a tool handler so auth and network failures become structured tool errors. */
const guarded =
  <A extends unknown[]>(fn: (...args: A) => Promise<CallToolResult>) =>
  async (...args: A): Promise<CallToolResult> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return errorResult(
          `Authentication required. ${err.message}\nההתחברות נכשלה או לא הושלמה — בקשו מהמשתמש להתחבר עם חשבון first-edea.com ונסו שוב. אין הרשאה חלופית.`,
        );
      }
      return errorResult(
        `Network or internal error: ${(err as Error).message}. אם זו קריאת apply_change — בטוח לנסות שוב עם אותו change_id (מפתח האידמפוטנטיות מונע כתיבה כפולה).`,
      );
    }
  };

const validationIssueShape = z.object({
  level: z.enum(['error', 'warning']),
  code: z.string(),
  screenId: z.string().optional(),
  message: z.string(),
});

const lockViolationShape = z.object({
  kind: z.enum(['mark', 'random-var', 'mark-value']),
  name: z.string(),
  value: z.string().optional(),
  message: z.string(),
});

export interface ServerDeps {
  api: ApiClient;
  proposals?: ProposalStore;
}

export function createSurveyMcpServer({ api, proposals = new ProposalStore() }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: 'mortgage-survey-editor', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'list_surveys',
    {
      title: 'רשימת השאלונים',
      description:
        'Lists every survey: slug, Hebrew name, whether a draft exists and when it changed, how many versions were published and the latest one. Read-only.',
      inputSchema: {},
      outputSchema: {
        surveys: z.array(
          z
            .object({
              slug: z.string(),
              name: z.string(),
              archived_at: z.string().nullable(),
              has_draft: z.boolean(),
              draft_updated_at: z.string().nullable(),
              versions: z.number(),
              latest_version: z.string().nullable(),
            })
            .passthrough(),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => {
      const res = await api.listSurveys();
      if (!res.ok) return failureResult(res);
      const lines = res.data.surveys.map((s) => {
        const status =
          s.versions > 0
            ? `פורסמו ${s.versions} גרסאות (אחרונה: ${s.latest_version}) — קודי האנליזה נעולים`
            : 'טרם פורסם — קודי האנליזה פתוחים';
        const archived = s.archived_at ? ' [בארכיון]' : '';
        return `- ${s.slug}: "${s.name}"${archived} — ${status}${s.has_draft ? `; טיוטה עודכנה ${s.draft_updated_at}` : '; אין טיוטה'}`;
      });
      return textResult(lines.join('\n') || 'אין שאלונים.', { surveys: res.data.surveys });
    }),
  );

  server.registerTool(
    'get_draft',
    {
      title: 'טעינת טיוטה',
      description:
        'Fetches a survey draft: a Hebrew outline (screens in order, routing and conditions as sentences, draws, marks, quotas), the full config JSON, and updated_at — the revision token propose_change needs. Always call this before proposing. Read-only.',
      inputSchema: {
        survey: slugSchema,
        full_config: z
          .boolean()
          .optional()
          .describe('Force the full config JSON even when it is very large'),
      },
      outputSchema: {
        updated_at: z.string().nullable(),
        outline: z.string(),
        config_included: z.boolean(),
        config: z.unknown().optional(),
        published_versions: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ survey, full_config }) => {
      const res = await api.getDraft(survey, true);
      if (!res.ok) return failureResult(res);
      const { config, updated_at } = res.data;
      const publishedVersions = res.data.published_versions ?? 0;
      if (!config) {
        return textResult(
          `לשאלון "${survey}" אין טיוטה עדיין. אפשר ליצור אחת עם propose_change כש-base_updated_at הוא null.`,
          { updated_at: null, outline: '', config_included: false, published_versions: publishedVersions },
        );
      }
      const outline = buildOutline(config);
      const configJson = JSON.stringify(config);
      const includeConfig = full_config === true || configJson.length <= INLINE_CONFIG_LIMIT_CHARS;
      const header =
        `שאלון: ${survey} · עדכון אחרון: ${updated_at} · גרסאות שפורסמו: ${publishedVersions}` +
        (publishedVersions > 0 ? ' (קודי האנליזה נעולים)' : '');
      const text = includeConfig
        ? `${header}\n\n${outline}\n\nconfig JSON:\n${configJson}`
        : `${header}\n\n${outline}\n\n(הקונפיג המלא גדול מ-${INLINE_CONFIG_LIMIT_CHARS.toLocaleString()} תווים — קראו שוב עם full_config: true לקבלתו. אין קיצוצים שקטים.)`;
      return textResult(text, {
        updated_at,
        outline,
        config_included: includeConfig,
        ...(includeConfig ? { config } : {}),
        published_versions: publishedVersions,
      });
    }),
  );

  server.registerTool(
    'propose_change',
    {
      title: 'הצעת שינוי (בדיקה בלבד)',
      description:
        'DRY RUN — writes nothing. Takes the full intended config and the base updated_at from get_draft, validates it, checks the analysis-code lock, and returns a structured diff plus a change_id. Show the diff and validation to the user and get explicit confirmation before apply_change.',
      inputSchema: {
        survey: slugSchema,
        // Deliberately opaque at the SDK layer: zod's object parsing rebuilds
        // objects and reorders keys, and the config must reach the server
        // byte-identical to what was composed. The boundary validation runs
        // in-handler (configSchema.safeParse) against the untouched value.
        // Untyped means some clients send it as JSON text; configAsObject
        // absorbs that without the SDK ever touching the value.
        config: z
          .unknown()
          .describe(
            'The complete intended SurveyConfig JSON — not a partial patch. A JSON object, or the same object as a JSON string.',
          ),
        base_updated_at: z
          .string()
          .nullable()
          .describe("The draft's updated_at from get_draft; null only when creating the first draft"),
        summary: summarySchema,
      },
      outputSchema: {
        ok: z.boolean(),
        change_id: z.string().optional(),
        diff: z.unknown().optional(),
        errors: z.array(validationIssueShape),
        warnings: z.array(validationIssueShape),
        code_lock: z.array(lockViolationShape),
        valid_screen_ids: z.array(z.string()).optional(),
        known_vars: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ survey, config: incoming, base_updated_at, summary }) => {
      // Normalise before the size check — a config sent as text would otherwise
      // be measured with its quoting and escapes counted in.
      const asObject = configAsObject(incoming);
      if (!asObject.ok) return errorResult(asObject.error);
      const config = asObject.config;

      // Mirror the server's 500KB cap before doing any work — a looping agent
      // proposing oversized configs should hit a cheap local wall, not fill
      // the proposal store and then discover the 413 at apply time.
      if (JSON.stringify(config).length > 500_000) {
        return errorResult(
          'Config exceeds the 500KB cap — it would be rejected at apply (413). הקונפיג גדול מ־500KB; יש לצמצם אותו.',
        );
      }
      // Untrusted input: check the load-bearing structure here, but keep using
      // the ORIGINAL object — parsing output would reorder its keys.
      const shape = configSchema.safeParse(config);
      if (!shape.success) {
        const issues = shape.error.issues
          .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n');
        return errorResult(`The config is structurally malformed:\n${issues}`);
      }

      const current = await api.getDraft(survey, true);
      if (!current.ok) return failureResult(current);

      if (current.data.updated_at !== base_updated_at) {
        return errorResult(
          `Stale base revision. base_updated_at (${base_updated_at}) does not match the current draft (${current.data.updated_at}). ` +
            'הטיוטה השתנתה מאז שנטענה — קראו get_draft מחדש ובנו את השינוי מעל המצב העדכני.',
        );
      }

      const proposed = config as unknown as SurveyConfig;
      const issues = validateConfig(proposed);
      const errors = issues.filter((i) => i.level === 'error');
      const warnings = issues.filter((i) => i.level === 'warning');

      const latest = current.data.latest_published;
      const lock =
        (current.data.published_versions ?? 0) > 0 && latest
          ? codeLockViolations(latest.config, proposed)
          : [];

      if (errors.length > 0 || lock.length > 0) {
        // Self-correction context: the ids and vars that DO exist in the
        // proposed config, so the model can fix references instead of guessing.
        const screenIds = proposed.screens.map((s) => s.id);
        const knownVars = [
          ...Object.keys(proposed.randomVars ?? {}),
          ...new Set(proposed.screens.flatMap((s) => (s.onSubmit ?? []).map((r) => r.var))),
        ];
        const parts = [
          errors.length > 0 ? `שגיאות ולידציה (חוסמות):\n${errors.map((e) => `- ${e.message}`).join('\n')}` : null,
          lock.length > 0 ? `קודים נעולים (השאלון כבר פורסם):\n${lock.map((v) => `- ${v.message}`).join('\n')}` : null,
          warnings.length > 0 ? `אזהרות:\n${warnings.map((w) => `- ${w.message}`).join('\n')}` : null,
          `מסכים קיימים בהצעה: ${screenIds.join(', ')}`,
          `סימונים והגרלות קיימים: ${knownVars.join(', ') || 'אין'}`,
        ].filter(Boolean);
        return {
          content: [{ type: 'text', text: `ההצעה נדחתה — אין change_id.\n\n${parts.join('\n\n')}` }],
          structuredContent: {
            ok: false,
            errors,
            warnings,
            code_lock: lock,
            valid_screen_ids: screenIds,
            known_vars: knownVars,
          },
          isError: true,
        };
      }

      const diff = diffConfigs(current.data.config, proposed);
      const changeId = proposals.put({
        survey,
        config: proposed,
        baseUpdatedAt: base_updated_at,
        summary,
      });
      const warningText =
        warnings.length > 0 ? `\n\nאזהרות (לא חוסמות):\n${warnings.map((w) => `- ${w.message}`).join('\n')}` : '';
      return textResult(
        `הצעה מוכנה (טרם נשמר דבר). change_id: ${changeId}\n\n` +
          `תקציר: ${summary}\n\nהשינויים:\n${renderDiff(diff, 'אין הבדל בין ההצעה לטיוטה הנוכחית.')}${warningText}\n\n` +
          'הציגו את השינויים והאזהרות למשתמש וקבלו אישור מפורש לפני apply_change.',
        { ok: true, change_id: changeId, diff, errors: [], warnings, code_lock: [] },
      );
    }),
  );

  server.registerTool(
    'apply_change',
    {
      title: 'החלת שינוי מאושר',
      description:
        'Applies a previously proposed change, byte-for-byte (hash-verified), to the survey DRAFT — never to published versions. Requires the change_id from propose_change and the user’s explicit confirmation. Retrying with the same change_id after a network failure is safe (idempotency key).',
      inputSchema: {
        change_id: z.string().min(1),
      },
      outputSchema: {
        applied: z.boolean(),
        survey: z.string(),
        updated_at: z.string(),
      },
      // destructiveHint stays true (the spec's default): the write REPLACES
      // the draft revision it was proposed against, and a client that gates
      // its confirmation UI on this hint must show the prompt. The optimistic
      // lock narrows what can be lost, but "additive only" would be a lie.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    guarded(async ({ change_id }) => {
      const proposal = proposals.take(change_id);
      if (!proposal) {
        return errorResult(
          'Unknown, expired, or already-applied change_id. הצעות תקפות ל-15 דקות ולשימוש חד-פעמי — קראו get_draft ולאחר מכן propose_change מחדש.',
        );
      }
      const res = await api.putDraft(proposal.survey, {
        config: proposal.config,
        expected_updated_at: proposal.baseUpdatedAt,
        idempotency_key: change_id,
        summary: proposal.summary,
      });
      if (!res.ok) {
        // A definitive rejection consumes the proposal — the fix is a fresh
        // propose. Transient failures (429, auth, 5xx) keep it, so the same
        // change_id can be retried safely.
        if (res.status === 409 || res.status === 422 || res.status === 413) {
          proposals.consume(change_id);
        }
        return failureResult(res);
      }
      proposals.consume(change_id);
      return textResult(
        `הטיוטה נשמרה. עדכון: ${res.data.updated_at} (שאלון "${proposal.survey}").\n` +
          'עכשיו: הריצו simulate_path לכל פרסונה/מסלול שהשינוי נוגע בהם ודווחו למשתמש; ' +
          'הזכירו למשתמש לעבור על הטיוטה בקונסולת /admin ולפרסם משם — פרסום הוא פעולה אנושית בלבד.',
        { applied: true, survey: proposal.survey, updated_at: res.data.updated_at },
      );
    }),
  );

  server.registerTool(
    'simulate_path',
    {
      title: 'סימולציית מסלול משיב',
      description:
        'Runs the engine’s pure path simulation: given answers and optional seed vars, returns the exact screen sequence a respondent would see — including quota routing when full_quota_cells marks cells as full. Use after every applied change to verify persona routing. Simulates the current draft, or a pending proposal when change_id is given. Read-only.',
      inputSchema: {
        survey: slugSchema,
        answers: z
          .record(z.unknown())
          .optional()
          .describe('screen id → the respondent’s answer (option id, number, array for multi…)'),
        seed_vars: seedVarsSchema
          .optional()
          .describe('Session vars fixed before the walk — e.g. a specific draw arm like {"price": 149}'),
        full_quota_cells: quotaCellsSchema
          .optional()
          .describe('Quota cells to treat as already full, to exercise quotafull routing'),
        change_id: z
          .string()
          .optional()
          .describe('Simulate a pending proposal instead of the saved draft'),
      },
      outputSchema: {
        steps: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            label: z.string(),
            end_variant: z.string().optional(),
          }),
        ),
        outcome: z.string(),
        final_vars: seedVarsSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ survey, answers, seed_vars, full_quota_cells, change_id }) => {
      let config: SurveyConfig | null;
      if (change_id) {
        const proposal = proposals.take(change_id);
        if (!proposal) {
          return errorResult('Unknown or expired change_id — propose again, or simulate the saved draft without change_id.');
        }
        config = proposal.config;
      } else {
        const res = await api.getDraft(survey, false);
        if (!res.ok) return failureResult(res);
        config = res.data.config;
      }
      if (!config) return errorResult(`לשאלון "${survey}" אין טיוטה לסמלץ.`);

      const vars: Vars = { ...(seed_vars ?? {}) };
      for (const cell of full_quota_cells ?? []) {
        vars[quotaFullVar(cell.mark, cell.value)] = true;
      }
      const steps = simulatePath(config, (answers ?? {}) as Answers, vars);
      const last = steps[steps.length - 1]?.screen;
      const outcome =
        last?.type === 'end'
          ? `הסתיים במסך "${last.id}" (${screenKindLabel(last)})`
          : 'לא הגיע לאף מסך סיום — ייתכן שחסרות תשובות במסלול';
      const lines = steps.map(
        (s, i) => `${i + 1}. [${s.screen.id}] ${screenKindLabel(s.screen)} — ${screenLabel(s.screen)}`,
      );
      const finalVars = steps.length > 0 ? steps[steps.length - 1].vars : vars;
      return textResult(
        `${lines.join('\n')}\n\n${outcome}\nמשתני הסשן בסוף: ${JSON.stringify(finalVars)}`,
        {
          steps: steps.map((s) => ({
            id: s.screen.id,
            type: s.screen.type,
            label: screenLabel(s.screen),
            ...(s.screen.type === 'end' ? { end_variant: s.screen.variant } : {}),
          })),
          outcome,
          final_vars: finalVars,
        },
      );
    }),
  );

  server.registerTool(
    'get_audit_log',
    {
      title: 'יומן שינויים (MCP)',
      description:
        'Recent MCP draft writes: who, when, which survey, revision before/after, and the change summary. Read-only.',
      inputSchema: {
        survey: slugSchema.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      outputSchema: {
        entries: z.array(
          z
            .object({
              user_email: z.string(),
              survey_id: z.string(),
              revision_before: z.string().nullable(),
              revision_after: z.string(),
              summary: z.string(),
              created_at: z.string(),
            })
            .passthrough(),
        ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ survey, limit }) => {
      const res = await api.getAudit(survey ?? null, limit ?? 20);
      if (!res.ok) return failureResult(res);
      const lines = res.data.entries.map(
        (e) => `- ${e.created_at} · ${e.user_email} · ${e.survey_id}: ${e.summary}`,
      );
      return textResult(lines.join('\n') || 'אין רשומות ביומן.', { entries: res.data.entries });
    }),
  );

  return server;
}
