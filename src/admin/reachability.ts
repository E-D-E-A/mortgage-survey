// Where the flow can land from here in sequence — the basis for both the edges in
// the diagram and the context panel.
//
// The problem this solves: the engine scans forward to the first screen that
// passes its display condition, and a naive translation of that into a drawing
// puts an edge to every screen up to the first unconditional one. In a survey
// where 55 of the 70 screens are conditional that produced 1,494 skip edges — the
// overwhelming majority of them transitions that cannot happen. Three rules
// shrink it, and all of them are exact rather than approximations:
//
//   1. Lane heads only. Consecutive screens with an identical condition fail or
//      succeed together — within one scan the context is fixed — so only the
//      first of them can be a landing target.
//   2. Contradiction and guarantee. If the source's condition requires segment=A
//      and the target's requires segment=B, the transition is impossible; and if
//      the target's condition is implied by the source's, the landing is certain
//      and the scan stops there.
//   3. Domination. A target whose condition implies an earlier target's condition
//      can never be chosen ahead of it.
//
// ⚠ The pruning has to be conservative: hiding a real transition is far worse
// than drawing too many. So anything that is not certain — an operator other than
// eq/in, an approximated condition — is simply not pruned.

import type { Condition, Op, Screen } from '../engine/types';

type Leaf = { q?: string; var?: string; op: Op; value?: unknown };

/** Decomposing into "all of these conditions must hold". any/not are not decomposed. */
export function conjuncts(cond: Condition | undefined): Condition[] {
  if (!cond) return [];
  if ('all' in cond) return cond.all.flatMap(conjuncts);
  return [cond];
}

/** A separate namespace for questions and variables — s_status and segment cannot collide. */
function refOf(cond: Condition): string | null {
  if ('q' in cond) return `q:${cond.q}`;
  if ('var' in cond) return `var:${cond.var}`;
  return null;
}

/** The set of values the condition permits, or null when it cannot be known for certain. */
function allowedValues(cond: Condition): Set<string> | null {
  const leaf = cond as Leaf;
  if (leaf.op === 'eq') return new Set([String(leaf.value)]);
  if (leaf.op === 'in') return new Set((Array.isArray(leaf.value) ? leaf.value : []).map(String));
  return null;
}

/** The two conditions cannot hold together: the same subject, and disjoint value sets. */
export function excludes(a: Condition[], b: Condition[]): boolean {
  for (const x of a) {
    const ref = refOf(x);
    if (!ref) continue;
    const xs = allowedValues(x);
    if (!xs) continue;
    for (const y of b) {
      if (refOf(y) !== ref) continue;
      const ys = allowedValues(y);
      if (!ys) continue;
      if (![...ys].some((v) => xs.has(v))) return true;
    }
  }
  return false;
}

/** The source's condition already contains everything the target requires — the landing is certain. */
export function guarantees(a: Condition[], b: Condition[]): boolean {
  if (b.length === 0) return true;
  const have = new Set(a.map((c) => JSON.stringify(c)));
  return b.every((c) => have.has(JSON.stringify(c)));
}

/**
 * How much of the source's display condition is still true at the moment of the
 * forward scan.
 *
 * The scan runs *after* the source's onSubmit, so a condition leaning on a
 * variable the source itself assigns, or on the answer to the source itself, is
 * no longer necessarily what it was when the screen was displayed. In the current
 * survey this does not arise, but without this filter a future config would
 * silently get wrong edges.
 */
function usableContext(source: Screen): Condition[] {
  const written = new Set((source.onSubmit ?? []).map((r) => r.var));
  return conjuncts(source.showIf).filter((c) => {
    if ('var' in c) return !written.has(c.var);
    if ('q' in c) return c.q !== source.id;
    return true;
  });
}

/** An unconditional routing rule always catches — there is no fall-through at all. */
function alwaysJumps(screen: Screen): boolean {
  return (screen.next ?? []).some((r) => !r.if);
}

/**
 * The screens the engine can land on when continuing from `index` in sequence,
 * in order. The first is the ordinary continuation; the rest are the alternatives
 * if it is skipped.
 */
export function fallThroughTargets(screens: Screen[], index: number): Screen[] {
  const source = screens[index];
  if (!source || source.type === 'end' || alwaysJumps(source)) return [];

  const context = usableContext(source);
  const out: Screen[] = [];
  let j = index + 1;
  while (j < screens.length) {
    const target = screens[j];
    if (!target.showIf) {
      out.push(target);
      break; // always displayed — there is no continuing past it
    }
    const targetConjuncts = conjuncts(target.showIf);
    // A target whose condition implies an earlier target's cannot be the landing:
    // if its condition holds then so does the earlier one's — and the scan would
    // have stopped there. This is what shrinks "all the track A screens" down to a
    // single target: the head of the track.
    const dominated = out.some((earlier) => guarantees(targetConjuncts, conjuncts(earlier.showIf)));
    if (!dominated && !excludes(context, targetConjuncts)) {
      out.push(target);
      if (guarantees(context, targetConjuncts)) break;
    }
    // Skipping the rest of the lane: an identical condition fails or succeeds together with its head
    const key = JSON.stringify(target.showIf);
    while (j + 1 < screens.length && screens[j + 1].showIf && JSON.stringify(screens[j + 1].showIf) === key) {
      j++;
    }
    j++;
  }
  return out;
}

/**
 * Who can land here in sequence — defined as the inverse of fallThroughTargets
 * rather than as a separate backwards walk, so the diagram and the panel cannot
 * tell two different stories.
 * Returned nearest first: the adjacent source is the ordinary story, and the
 * distant ones are the exceptions.
 */
export function fallThroughSources(screens: Screen[], index: number): Screen[] {
  const id = screens[index]?.id;
  if (!id) return [];
  return screens
    .slice(0, index)
    .filter((_, j) => fallThroughTargets(screens, j).some((t) => t.id === id))
    .reverse();
}
