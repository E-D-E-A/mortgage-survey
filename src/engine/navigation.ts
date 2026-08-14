// Pure navigation logic: given the current screen and the session context,
// decide which screen comes next. Extracted from App.tsx so it can be unit-tested
// and reused by the admin console (e.g. path preview).

import { evaluate } from './conditions';
import { hitsFullQuota, quotaFullScreen } from './quota';
import type { Screen, SurveyConfig, SurveyContext } from './types';

/**
 * Routing: explicit next rules first (the first one whose condition holds),
 * otherwise a forward scan in array order to the first screen that passes its
 * showIf. null = there is no next screen.
 *
 * A full quota is handled here rather than as a routing rule the admin writes:
 * it applies to *every* screen that marks a value which has filled up, and
 * writing it by hand on each such screen would be work that repeats itself —
 * and gets forgotten on exactly one screen. With no quotafull end screen there
 * is nowhere to route, so the engine carries on as usual; the validator is what
 * reports the missing definition.
 */
export function findNext(config: SurveyConfig, from: Screen, ctx: SurveyContext): Screen | null {
  const quotaFull = () => (hitsFullQuota(from, ctx) ? quotaFullScreen(config) : null);

  for (const rule of from.next ?? []) {
    if (!rule.if || evaluate(rule.if, ctx)) {
      const target = config.screens.find((s) => s.id === rule.goto) ?? null;
      // An explicit screenout beats a full quota: "not qualified for the study"
      // is a stronger statement than "we already have enough people like you",
      // and the two are counted completely differently in analysis.
      if (target?.type === 'end' && target.variant === 'screenout') return target;
      return quotaFull() ?? target;
    }
  }

  const full = quotaFull();
  if (full) return full;

  const idx = config.screens.findIndex((s) => s.id === from.id);
  for (let i = idx + 1; i < config.screens.length; i++) {
    const candidate = config.screens[i];
    if (!candidate.showIf || evaluate(candidate.showIf, ctx)) return candidate;
  }
  return null;
}
