// ENG-22: an analysis code stays editable until the survey's first publish, and
// locks from then on. The rule used to sit inline inside two components, where no
// test could reach it — which is how the whole feature came to ship with none.

import { describe, expect, it } from 'vitest';
import { codesLockedFor, isCodeFieldLocked } from './codeLock';

describe('codesLockedFor', () => {
  it('a survey that has never been published leaves its codes open', () => {
    expect(codesLockedFor({ versions: 0 })).toBe(false);
  });

  it('the first published version locks them, and every version after it', () => {
    expect(codesLockedFor({ versions: 1 })).toBe(true);
    expect(codesLockedFor({ versions: 7 })).toBe(true);
  });

  it('an unknown publish state locks — the console fails safe while the list loads', () => {
    // The two mistakes are not the same size: an unnecessary lock is an
    // annoyance for a few hundred milliseconds, an unnecessary unlock invites
    // renaming a code that collected answers already point at.
    expect(codesLockedFor(undefined)).toBe(true);
  });
});

describe('isCodeFieldLocked', () => {
  it('a code written for the first time is editable even on a survey published long ago', () => {
    expect(isCodeFieldLocked(false, true)).toBe(false);
  });

  it('renaming is locked exactly when the survey has been published', () => {
    expect(isCodeFieldLocked(true, true)).toBe(true);
    expect(isCodeFieldLocked(true, false)).toBe(false);
  });
});
