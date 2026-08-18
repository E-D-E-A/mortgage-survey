import { describe, expect, it } from 'vitest';
import type { Condition, Screen } from '../engine/types';
import { fallThroughSources, fallThroughTargets } from './reachability';

const inA: Condition = { var: 'segment', op: 'eq', value: 'A' };
const inB: Condition = { var: 'segment', op: 'eq', value: 'B' };

const info = (id: string, extra: Partial<Screen> = {}): Screen =>
  ({ id, type: 'info', title: id, body: '', ...extra }) as Screen;

const screens = [
  info('intro'),
  info('a1', { showIf: inA }),
  info('a2', { showIf: inA }),
  info('a3', { showIf: inA }),
  info('b1', { showIf: inB }),
  info('demog'),
  { id: 'end_complete', type: 'end', variant: 'complete', title: 'ת', body: '' } as Screen,
];

const ids = (list: Screen[]) => list.map((s) => s.id);

describe('fall-through neighbours', () => {
  // The panel claims "you get here from X" — a claim about the real flow, so it is tested.
  it('lists only the screens that can really land here, nearest first', () => {
    // a1/a2 are not on the list: from a1 the screen a2 is certain (exactly the same
    // condition), so from there demog cannot be landed on at all — this is exactly
    // the clutter the pruning removes
    expect(ids(fallThroughSources(screens, 5))).toEqual(['b1', 'a3', 'intro']);
  });

  it('stops immediately when the previous screen is always shown', () => {
    expect(ids(fallThroughSources(screens, 1))).toEqual(['intro']);
  });

  it('skips a predecessor that always jumps elsewhere', () => {
    const withGoto = [info('a', { next: [{ goto: 'c' }] }), info('b', { showIf: inA }), info('c')];
    expect(ids(fallThroughSources(withGoto, 1))).toEqual([]);
  });

  it('never treats an end screen as falling through', () => {
    const afterEnd = [{ id: 'e', type: 'end', variant: 'complete', title: '', body: '' } as Screen, info('x')];
    expect(ids(fallThroughSources(afterEnd, 1))).toEqual([]);
  });

  it('names one landing per branch, not one per screen', () => {
    // From intro: the head of lane A, the head of lane B, then the first always-shown screen
    expect(ids(fallThroughTargets(screens, 0))).toEqual(['a1', 'b1', 'demog']);
    // From a3 (segment=A): lane B is pruned, and only the always-shown screen is left
    expect(ids(fallThroughTargets(screens, 3))).toEqual(['demog']);
  });

  it('stops as soon as the next screen is certain', () => {
    // a2 shares an identical condition with a1, so if a1 was shown, a2 will be. There is no other continuation.
    expect(ids(fallThroughTargets(screens, 1))).toEqual(['a2']);
  });

  it('drops a branch whose condition contradicts the source', () => {
    // From a3 (segment=A) there is no landing on b1 (segment=B)
    expect(ids(fallThroughTargets(screens, 3))).not.toContain('b1');
  });
});
