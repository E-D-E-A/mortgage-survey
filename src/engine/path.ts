// The path a respondent actually walks in a given context — the basis for two
// things the full screen array cannot give: pruning answers from an abandoned
// branch, and a progress bar that means something.

import { evaluate } from './conditions';
import { findNext } from './navigation';
import type { Answers, Screen, SurveyConfig, SurveyContext, Vars } from './types';

/**
 * Simulates the walk from the first screen with the given context: it honours
 * showIf, next/goto rules and the forward scan — exactly like a real respondent.
 *
 * `seen` guards against cycles: validation blocks them, but a config published
 * before that block existed may still contain one, and a pure function has no
 * business hanging in a loop.
 */
export function visitedPath(config: SurveyConfig, ctx: SurveyContext): Screen[] {
  const path: Screen[] = [];
  const seen = new Set<string>();
  let current: Screen | null = config.screens[0] ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    if (current.type === 'end') break;
    current = findNext(config, current, ctx);
  }
  return path;
}

export interface SimStep {
  screen: Screen;
  /** The session vars after this screen's onSubmit — what the screens after it will see */
  vars: Vars;
}

/**
 * A dry run of the survey over given answers: like visitedPath, but it also
 * applies the onSubmit rules along the way instead of receiving the vars from
 * outside.
 *
 * That is what lets the console show a real path from answers alone — without it
 * every screen that depends on segment would drop out, because the variable is
 * only set during the journey.
 * ⚠ Order within onSubmit matters: a rule sees what came before it, exactly as
 * in App.
 */
export function simulatePath(config: SurveyConfig, answers: Answers, seed: Vars = {}): SimStep[] {
  const steps: SimStep[] = [];
  const seen = new Set<string>();
  const vars: Vars = { ...seed };
  const ctx: SurveyContext = { answers, vars };
  let current: Screen | null = config.screens[0] ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (const rule of current.onSubmit ?? []) {
      if (!rule.if || evaluate(rule.if, ctx)) vars[rule.var] = rule.value;
    }
    steps.push({ screen: current, vars: { ...vars } });
    if (current.type === 'end') break;
    current = findNext(config, current, ctx);
  }
  return steps;
}

/**
 * Prunes the final payload. A respondent who went back and changed a routing
 * answer (s_actions, say, moving them from B to C) leaves behind answers to
 * screens that are no longer theirs — those sit in state.answers and contaminate
 * every by-segment analysis.
 *
 * ⚠ The pruning applies to the payload only. state.answers stays whole, so that
 * going back keeps showing the respondent what they answered (see the seeding in
 * components/inputs.tsx).
 */
export function pruneAnswers(config: SurveyConfig, ctx: SurveyContext): Answers {
  const onPath = new Set(visitedPath(config, ctx).map((s) => s.id));
  const pruned: Answers = {};
  for (const [screenId, value] of Object.entries(ctx.answers)) {
    if (onPath.has(screenId)) pruned[screenId] = value;
  }
  return pruned;
}

/**
 * Progress (0..1) along the path expected in the current context, not along the
 * full array — otherwise a respondent in segment A "jumps" tens of percent the
 * moment the other two segments drop out.
 *
 * ⚠ The value is not monotonic on its own: while segment is still unset, all the
 * A/B/C screens drop out and the expected path is short. The caller is
 * responsible for holding a running maximum (see App.tsx) so the bar never
 * retreats.
 */
export function progressRatio(config: SurveyConfig, currentId: string, ctx: SurveyContext): number {
  const path = visitedPath(config, ctx);
  const index = path.findIndex((s) => s.id === currentId);
  const last = path.length - 1;
  if (index < 0 || last <= 0) return 0;
  return index / last;
}
