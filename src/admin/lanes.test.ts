import { describe, expect, it } from 'vitest';
import type { Condition, Screen } from '../engine/types';
import { laneMembers } from './lanes';

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

describe('laneMembers', () => {
  it('collects the whole run sharing one condition, from any member', () => {
    expect(laneMembers(screens, 'a2')).toEqual(['a1', 'a2', 'a3']);
    expect(laneMembers(screens, 'a1')).toEqual(['a1', 'a2', 'a3']);
  });

  it('stops at a different condition', () => {
    expect(laneMembers(screens, 'b1')).toEqual(['b1']);
  });

  it('leaves an unconditional screen alone', () => {
    expect(laneMembers(screens, 'demog')).toEqual(['demog']);
  });

  it('does not merge two runs of the same condition split by another screen', () => {
    const split = [info('a1', { showIf: inA }), info('mid'), info('a2', { showIf: inA })];
    expect(laneMembers(split, 'a1')).toEqual(['a1']);
    expect(laneMembers(split, 'a2')).toEqual(['a2']);
  });

  it('returns nothing for an id that is not in the survey', () => {
    expect(laneMembers(screens, 'gone')).toEqual([]);
  });
});
