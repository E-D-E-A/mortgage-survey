// The draw behind every A/B variable. initVars calls pickRandom once per
// randomVars entry when a session starts, and whatever comes back is the arm the
// respondent is shown and, at the end, measured in.
//
// Nothing exercised this file before: a draw that always landed on the first arm
// would have looked exactly like a working experiment, right up to the analysis
// that found one arm empty.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickRandom } from './random';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pickRandom', () => {
  it('returns a value that is actually in the list', () => {
    const arms = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 500; i++) expect(arms).toContain(pickRandom(arms));
  });

  it('a list of one value returns that value every time', () => {
    for (let i = 0; i < 20; i++) expect(pickRandom(['only'])).toBe('only');
  });

  it('reaches every arm, not only the first', () => {
    // The failure this guards against is silent: every respondent draws arm A,
    // the study runs to completion, and the second arm has nobody in it.
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.75);
    const arms = ['w', 'x', 'y', 'z'];
    expect([pickRandom(arms), pickRandom(arms), pickRandom(arms), pickRandom(arms)]).toEqual(arms);
  });

  it('a draw just short of 1 lands on the last arm, not past the end of the list', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999999999);
    expect(pickRandom(['a', 'b', 'c'])).toBe('c');
  });

  it('a draw of exactly 0 lands on the first arm', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickRandom(['a', 'b', 'c'])).toBe('a');
  });

  it('an empty list yields undefined — the "at least two values" rule is the validator’s, not this function’s', () => {
    expect(pickRandom([])).toBeUndefined();
  });
});
