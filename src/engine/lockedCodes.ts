// The analysis-code lock, as a checkable rule: which codes a published config
// uses, and which of them a new draft renames or removes.
//
// The admin console enforces the lock through disabled form fields
// (src/admin/codeLock.ts) — good enough for a UI where every edit passes
// through those fields. The MCP write path receives whole configs from an
// agent and bypasses the UI entirely, so the same rule has to be enforceable
// server-side over the config itself. This module is that rule; the MCP write
// endpoint (netlify/functions/mcp-draft.mts) and the MCP server's dry run both
// call it, so the agent's preview and the server's gate can never disagree.
//
// What is locked, from the first publish onward:
//   - a mark name the published config assigns (onSubmit rules);
//   - a randomVar name the published config draws;
//   - a (mark, value) pair the published config assigns — the value codes
//     answers are already recorded under.
// A draw's value list deliberately stays editable (README: the lock covers the
// code, not a draw's values — otherwise a running survey could never gain or
// adjust an experiment arm). Labels and quotas in varMeta are display and
// collection settings, not codes, and stay editable too.

import type { SurveyConfig } from './types';

export interface CodeLockViolation {
  kind: 'mark' | 'random-var' | 'mark-value';
  /** The locked code: the mark or randomVar name */
  name: string;
  /** For kind 'mark-value' — the value code that disappeared */
  value?: string;
  message: string;
}

/** Every var name the config assigns via onSubmit rules. */
function assignedMarks(config: SurveyConfig): Set<string> {
  const marks = new Set<string>();
  for (const s of config.screens ?? []) {
    for (const r of s.onSubmit ?? []) marks.add(r.var);
  }
  return marks;
}

/** A collision-proof key for a (name, value) pair — values may contain anything. */
const pairKey = (name: string, value: unknown): string => JSON.stringify([name, String(value)]);

/** Every (mark, value) pair the config assigns. */
function assignedPairs(config: SurveyConfig): Map<string, { name: string; value: string }> {
  const pairs = new Map<string, { name: string; value: string }>();
  for (const s of config.screens ?? []) {
    for (const r of s.onSubmit ?? []) {
      pairs.set(pairKey(r.var, r.value), { name: r.var, value: String(r.value) });
    }
  }
  return pairs;
}

/**
 * The violations a draft commits against the codes a published config uses.
 * Empty array = the draft keeps every locked code. The caller decides whether
 * the lock applies at all (it applies only when the survey has ≥1 published
 * version — before that there is no data to orphan).
 *
 * A code counts as "kept" whichever mechanism produces it: a mark that became
 * a draw (or the reverse) still writes the same variable name into the data,
 * and the lock protects the data's vocabulary, not the editing mechanism.
 * Nonsense combinations (a draw overwritten by rules) are validateConfig's
 * business, and the write path runs it as well.
 */
export function codeLockViolations(
  published: SurveyConfig,
  draft: SurveyConfig,
): CodeLockViolation[] {
  const violations: CodeLockViolation[] = [];

  const draftDraws = new Set(Object.keys(draft.randomVars ?? {}));
  const draftMarks = assignedMarks(draft);
  const draftPairs = assignedPairs(draft);
  const draftDrawValues = new Set(
    Object.entries(draft.randomVars ?? {}).flatMap(([name, values]) =>
      (Array.isArray(values) ? values : []).map((v) => pairKey(name, v)),
    ),
  );

  for (const name of Object.keys(published.randomVars ?? {})) {
    if (draftDraws.has(name) || draftMarks.has(name)) continue;
    violations.push({
      kind: 'random-var',
      name,
      message: `ההגרלה "${name}" קיימת בגרסה שפורסמה ונמחקה או שונה שמה בטיוטה — הקוד נעול כי תשובות שכבר נאספו רשומות תחתיו`,
    });
  }

  for (const name of assignedMarks(published)) {
    if (draftMarks.has(name) || draftDraws.has(name)) continue;
    violations.push({
      kind: 'mark',
      name,
      message: `הסימון "${name}" קיים בגרסה שפורסמה ואף מסך בטיוטה לא קובע אותו — הקוד נעול כי תשובות שכבר נאספו רשומות תחתיו`,
    });
  }

  for (const [key, { name, value }] of assignedPairs(published)) {
    // A missing mark is already reported above — a value-level message per pair
    // would bury the real finding under its consequences.
    if (!draftMarks.has(name) && !draftDraws.has(name)) continue;
    if (draftPairs.has(key) || draftDrawValues.has(key)) continue;
    violations.push({
      kind: 'mark-value',
      name,
      value,
      message: `הערך "${value}" של הסימון "${name}" קיים בגרסה שפורסמה ואף מסך בטיוטה לא קובע אותו — קוד של ערך נעול מהפרסום הראשון, כי תשובות שכבר נאספו רשומות תחתיו`,
    });
  }

  return violations;
}
