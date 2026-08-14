// Quotas at run time: from the definition (varMeta.quotas) to session state, and
// from there to routing.
//
// The engine itself counts nothing and touches no network. Quota state reaches it
// as ordinary session vars — `quota_full_<mark>_<value> = true` — set once on
// entry (src/data/quota.ts) and fixed from then on for the whole session. Two
// consequences of that choice: the engine stays pure and testable, and a
// respondent who started while a cell was open is never thrown out mid-survey
// because it filled up in the meantime.
//
// The count is deliberately approximate: two respondents can pass the last slot
// together. That is the standard for surveys, and one or two over is far cheaper
// than turning real respondents away.

import type { Screen, SurveyConfig, SurveyContext, Vars } from './types';

/** A mark value that carries a ceiling. */
export interface QuotaCell {
  mark: string;
  value: string;
  limit: number;
}

/** How many respondents finished, by mark and value: counts[mark][value]. */
export type QuotaCounts = Record<string, Record<string, number>>;

/**
 * The name of the session var that flags a full cell. The shape of the name is
 * deliberate, not incidental: it has to be unique against real marks, and it is
 * kept in the session_start payload — which is how analysis can tell which cells
 * were already closed when a respondent came in.
 */
export function quotaFullVar(mark: string, value: string | number | boolean): string {
  return `quota_full_${mark}_${value}`;
}

/** Every cell that has a ceiling. Stable order — the order they are defined in varMeta. */
export function quotaCells(config: SurveyConfig): QuotaCell[] {
  return Object.entries(config.varMeta ?? {}).flatMap(([mark, meta]) =>
    Object.entries(meta.quotas ?? {}).map(([value, limit]) => ({ mark, value, limit })),
  );
}

/** The session vars derived from the counts — only full cells are recorded, the rest are simply absent. */
export function quotaVars(config: SurveyConfig, counts: QuotaCounts): Vars {
  const vars: Vars = {};
  for (const { mark, value, limit } of quotaCells(config)) {
    if ((counts[mark]?.[value] ?? 0) >= limit) vars[quotaFullVar(mark, value)] = true;
  }
  return vars;
}

/** The "quota is full" end screen, or null — in which case there is nowhere to route and the quota is not enforced. */
export function quotaFullScreen(config: SurveyConfig): Screen | null {
  return config.screens.find((s) => s.type === 'end' && s.variant === 'quotafull') ?? null;
}

/**
 * Whether this screen has just put the respondent into a full cell.
 *
 * The check runs against the ctx *after* the onSubmit rules (that is how App.tsx
 * and simulatePath call findNext), so it asks two questions at once: this screen
 * is one of those that set the value, and the respondent is indeed carrying it
 * now. Re-running the conditions here would run them against a different context
 * from the one they were decided in — and could give a different answer from the
 * one that actually took effect.
 */
export function hitsFullQuota(screen: Screen, ctx: SurveyContext): boolean {
  return (screen.onSubmit ?? []).some(
    (rule) =>
      ctx.vars[rule.var] === rule.value &&
      ctx.vars[quotaFullVar(rule.var, rule.value)] === true,
  );
}
