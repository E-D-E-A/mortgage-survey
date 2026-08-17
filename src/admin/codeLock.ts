// When an analysis code may still be edited.
//
// Two halves of one decision, and they live here rather than inline in the two
// components that ask, for the same reason display.ts and vars.ts exist: this is
// the part that carries a rule, and a rule written inside JSX cannot be tested at
// all — the suite runs in node, with no renderer.

/** What the survey list knows about a survey; only the published count matters here. */
interface PublishState {
  /** How many versions have been published */
  versions: number;
}

/**
 * Whether this survey's analysis codes are locked.
 *
 * The lock exists because changing a code cuts it off from data already
 * collected. That reason only holds once data exists, so before the first
 * publish the codes stay open — and from the first publish onwards they are
 * locked for good.
 *
 * ⚠ An unknown survey (the list has not loaded yet) locks. The two mistakes are
 * not symmetrical: an unnecessary lock is an annoyance for a few hundred
 * milliseconds, while an unnecessary unlock invites a rename of a code that
 * collected answers already point at.
 */
export function codesLockedFor(survey: PublishState | undefined): boolean {
  return survey ? survey.versions > 0 : true;
}

/**
 * Whether the code field itself is disabled right now.
 *
 * The lock applies to renaming only. A code being written for the first time has
 * nothing behind it to cut off, so it is always editable — even on a survey that
 * has been published for months.
 */
export function isCodeFieldLocked(renaming: boolean, codesLocked: boolean): boolean {
  return renaming && codesLocked;
}
