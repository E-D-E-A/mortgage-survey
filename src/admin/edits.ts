// Structural edits to the screen list, as pure functions: where a new screen
// goes in, and what exactly gets copied on duplication. Both look trivial and
// both were a source of silent bugs (QA report 2026-08-08, A6 and A11), which is
// why they live here rather than inside a component.

import type { Screen } from '../engine/types';

/** A free id based on `base`, without colliding with the existing ones. */
export function uniqueId(base: string, screens: Screen[]): string {
  const taken = new Set(screens.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Whether two versions of the config share exactly the same shape — the same keys
 * at every level, the same array lengths — and differ only in a leaf value.
 *
 * This is what tells typing in a field (same shape, one more character) apart
 * from a structural action (adding an option, deleting a row, removing a
 * condition). The undo history merges edits made in quick succession so that
 * typing does not produce an undo step per character — but without this
 * distinction two button presses within a second merged too, and a single undo
 * reversed several separate actions the editor took deliberately.
 */
export function sameShape(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i]))
    );
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a as object);
    if (keys.length !== Object.keys(b as object).length) return false;
    return keys.every(
      (k) =>
        k in (b as object) &&
        sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  // A leaf: swapping the type (number ↔ string) is a structural change too, not typing
  return typeof a === typeof b;
}

/**
 * The next free code for an option or a matrix row.
 *
 * Counting by list length produces a duplicate code the moment a row in the
 * middle is deleted: opt_1..opt_3, delete opt_1, and "add an option" produces an
 * opt_3 that already exists. Validation does warn about it, but the error is born
 * from clicking a perfectly valid button — and in analysis two rows with the same
 * code cannot be told apart.
 */
export function nextChoiceId(prefix: string, taken: readonly { id: string }[]): string {
  const used = new Set(taken.map((t) => t.id));
  for (let n = taken.length + 1; ; n++) {
    const id = `${prefix}_${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * Where a new screen goes in.
 *
 * Appending to the end of the array landed it after the end screens: every
 * insertion immediately produced an "unreachable from the first screen" warning
 * and required dragging it by hand past 70 items. Instead — after the currently
 * selected screen, and with nothing selected (or an end screen selected) before
 * the first end screen.
 */
export function insertScreen(
  screens: Screen[],
  added: Screen,
  selectedId: string | null,
): Screen[] {
  // A new end screen goes to the very end: putting it before an existing end
  // screen would hijack the fall-through of the screen before it and change how
  // the survey ends without the editor asking for that
  if (added.type === 'end') return [...screens, added];

  const selected = selectedId ? screens.findIndex((s) => s.id === selectedId) : -1;
  const firstEnd = screens.findIndex((s) => s.type === 'end');
  const at =
    selected >= 0 && screens[selected].type !== 'end'
      ? selected + 1
      : firstEnd >= 0
        ? firstEnd
        : screens.length;

  const next = [...screens];
  next.splice(at, 0, added);
  return next;
}

/**
 * Duplicating a screen — it copies the *content* only, right after the original.
 *
 * A full deep copy produced two screens assigning the same variable or routing to
 * the same target; that is very easy to create by accident (the duplicate button
 * sits next to delete in the hover bar) and very hard to notice. showIf is kept —
 * it is part of "where this screen lives", and the copy is meant to sit in the
 * same section as the original.
 */
export function duplicateScreen(screens: Screen[], id: string): Screen[] {
  const index = screens.findIndex((s) => s.id === id);
  if (index < 0) return screens;

  const { next: _next, onSubmit: _onSubmit, ...content } = screens[index];
  const copy = structuredClone(content) as Screen;
  copy.id = uniqueId(`${id}_2`, screens);

  const out = [...screens];
  out.splice(index + 1, 0, copy);
  return out;
}
