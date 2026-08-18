# MCP server — design decisions

An MCP (Model Context Protocol) server that lets teammates edit survey drafts
through Claude in natural language. This document records the decisions and the
reasoning; SETUP.md is the how-to.

## Protocol and SDK

- **Protocol revision: 2025-11-25**, via **`@modelcontextprotocol/sdk` 1.30.0**
  (`LATEST_PROTOCOL_VERSION = '2025-11-25'`). At the time of writing the newest
  spec revision is **2026-07-28** ("stateless MCP": no initialize handshake, a
  `server/discover` RPC, elicitation re-expressed as Multi Round-Trip Requests),
  but it is implemented only by the v2 SDK alpha (`@modelcontextprotocol/server`
  2.0.0-alpha, zod v4 / full `z.object()` schemas). Building on an alpha for a
  production tool is the wrong trade; the 1.x line negotiates with every current
  client.
- **Migration note (v2):** when moving to the v2 SDK, `registerTool` raw shapes
  become full `z.object()` schemas, and any confirmation UX can move from
  instructions to MRTR elicitation (`resultType: "input_required"`).
- Tools declare **`outputSchema`** and return **`structuredContent`** plus a
  text block (the 2025-06-18 structured-output contract). Input-validation
  failures are returned as tool execution errors (`isError: true`), not
  protocol errors, per SEP-1303 — so the model can read them and self-correct.

## Architecture: a thin, untrusted client

The MCP server is a *client* of the existing Netlify admin API, and the design
assumes it is hostile: anyone can run a modified copy. Therefore **every
guarantee lives server-side**, in Netlify functions behind `requireAdmin`:

| Guarantee | Enforced in |
|---|---|
| Google auth, verified email, first-edea.com domain | `netlify/functions/lib/session.ts` (unchanged, same as the console) |
| Draft validation gate (errors block the write) | `mcp-draft.mts` → `validateConfig` — the same function the console and publish use |
| Analysis-code lock after first publish | `mcp-draft.mts` → `src/engine/lockedCodes.ts` |
| Optimistic locking (409 carries current `updated_at`) | `mcp-draft.mts` |
| Idempotency (replay returns stored result) | `mcp-draft.mts` + `mcp_idempotency_keys` table |
| Rate limits (30 writes/h, 300 reads/h, per user) | `lib/mcp.ts` + `mcp_rate_hit` SQL function |
| Audit log | `mcp-draft.mts` + `mcp_audit_log` table |

The MCP layer's own checks (zod boundary schemas, the dry-run validation in
`propose_change`, the proposal hash) are **UX**, not security: they give the
model fast, precise feedback and give the human a trustworthy preview. A client
that skips them changes nothing about what the server accepts.

The console's contract is untouched: `admin-draft.mts` still accepts invalid
drafts (a human mid-edit may save anything; validation gates publishing only).
The strict semantics live in a **sibling** endpoint (`mcp-draft.mts`) rather
than flags on the console's — two callers with opposite needs should not share
one code path's conditionals.

## Transport and authorization

- **stdio, run locally by each teammate.** The MCP authorization spec is
  explicit that stdio servers "SHOULD NOT" implement the HTTP OAuth
  resource-server framework and should instead take credentials from the
  environment. That is what happens here: the server runs the console's own
  Google-via-Supabase PKCE login in the teammate's browser (loopback redirect
  on `127.0.0.1`), caches the session in a user-only file (0600 best-effort;
  on Windows the profile ACL is the real fence), and refreshes silently.
- **No token passthrough.** The server never accepts a token as a tool
  argument, and the only network destination in the whole package is the app's
  own `/.netlify/functions/*`. The Bearer token it sends is the teammate's own
  Supabase session token, issued by the app's auth system for the app — the
  exact credential the console sends. Revocation = delete/ban the user in
  Supabase, same as today.
- The server holds the **public anon key** only (it already ships in the
  console's browser bundle); the service_role key exists nowhere in this
  package and must never be added to it.
- **v2 (not built): a remotely hosted MCP endpoint.** That requires the full
  OAuth 2.1 resource-server pattern: Protected Resource Metadata (RFC 9728),
  audience-bound tokens via RFC 8707 `resource` indicators, Client ID Metadata
  Documents (DCR is deprecated as of 2026-07-28), streamable HTTP transport.
  None of it is justified while every user is a first-edea.com teammate with a
  laptop.

## Engine reuse

The repo became an **npm workspace** (`workspaces: ["tools/mcp-server"]`), so
one `npm install` at the root installs everything, and vitest at the root can
reach the SDK for the in-memory integration tests. Engine code is imported **by
relative path** (`../../../src/engine/...`), exactly like the Netlify functions
import it — the same modules, never a copy:

- `validateConfig` — the dry run and the server gate return the identical issue list;
- `simulatePath` / `quotaFullVar` — persona verification, including quota routing;
- `makeNaming` / `conditionSentence` / `screenLabel` — outlines and diffs speak
  the console's Hebrew;
- `codeLockViolations` (new, in `src/engine/`) — one rule for the dry run and
  the server, so the preview can never disagree with the gate.

`esbuild` bundles the entry point into a single `dist/index.mjs` (engine code
included, dependencies inlined) so the Claude client config is one `node` line
with no loader tricks.

## Tool design

Six tools, annotated accurately:

- `list_surveys`, `get_draft`, `simulate_path`, `get_audit_log` —
  `readOnlyHint: true, openWorldHint: false`.
- `propose_change` — also `readOnlyHint: true`: it writes nothing anywhere; it
  stages a proposal in process memory. Keeping it read-only is deliberate — the
  approval friction belongs on `apply_change`, the one tool that mutates.
- `apply_change` — `readOnlyHint: false, destructiveHint: false` (the
  optimistic lock means it can only replace a draft revision it has seen, never
  clobber unseen work), `idempotentHint: true` (the change_id doubles as the
  server-side idempotency key, so a retry cannot double-apply).

**Byte-for-byte configs.** `propose_change` accepts `config` as `z.unknown()`
and validates it in-handler with the boundary schema, keeping the *original*
object: zod's object parsing rebuilds objects and reorders keys, which broke
the golden-task byte-identity test. The proposal stores the object and its
SHA-256; `apply_change` re-hashes before sending. One honest caveat: Postgres
`jsonb` canonicalizes key order at rest (the console's drafts have the same
property), so "byte-identical" means intact structure and exact strings, not
stable key order across a DB round-trip.

**Proposals are in-process** (15-minute TTL, single-use). For a single-user
stdio server that is exactly the right scope: the change_id's job is to bind
"what the human confirmed" to "what gets sent", and both ends of that binding
live in this process. A restart loses pending proposals — the failure mode is
"propose again", not a security hole.

**Large configs**: `get_draft` inlines the config JSON up to 60k characters;
beyond that it returns the outline plus an explicit `full_config: true` retry
path. Nothing is ever truncated silently. The server's 500KB cap surfaces as a
clear 413 message.

**Elicitation** was considered for the confirm-before-apply step and not used:
client support is uneven in the 1.x ecosystem, and the server instructions +
the `apply_change` approval prompt already put a human in the loop. Revisit
with MRTR when moving to the v2 SDK.

## Deliberate absences

No publish tool, no delete, no archive — and not as a blocked branch, but as
missing code: neither this package nor the endpoints it calls contain any path
that writes `survey_configs`, `surveys`, or `survey_events`. `mcp-draft.mts`
touches `survey_drafts` and the three MCP bookkeeping tables; `mcp-surveys.mts`
and `mcp-audit.mts` are GET-only. Publishing stays a human action in `/admin`,
where the same `validateConfig` gates it again.

## Server-side details worth remembering

- **Rate limiting** is a fixed hourly window in `mcp_rate_limits`, incremented
  atomically by the `mcp_rate_hit` SQL function (upsert + count in one
  statement — a read-then-write in the function would race). Budgets are
  env-tunable (`MCP_WRITE_LIMIT_PER_HOUR`, `MCP_READ_LIMIT_PER_HOUR`); the
  429 body and `Retry-After` header carry the seconds until the window turns.
  It fails **closed**: if the counter is unreachable, the request is a 502,
  not a free pass.
- **Idempotency keys** store only *executed* writes (rejections are
  deterministic and cheap to recompute). Replay returns the stored response
  with `X-Idempotent-Replay: true` and burns no write budget. TTL 24h, swept
  opportunistically on the write path — no scheduler needed.
- **The audit log** records who/when/survey/revision-before/revision-after plus
  the agent-supplied summary, on every executed write. It has no FK to
  `surveys`: a log that can block a survey delete is not a log.
