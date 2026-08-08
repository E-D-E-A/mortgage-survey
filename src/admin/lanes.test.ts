import { describe, expect, it } from 'vitest';
import type { Condition, Screen } from '../engine/types';
import { laneMembers } from './lanes';
import { sequentialPredecessors, sequentialSuccessors } from './FlowContext';

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

const ids = (list: Screen[]) => list.map((s) => s.id);

describe('sequential neighbours', () => {
  // הפאנל טוען "מגיעים לכאן מ־X" — טענה על הזרימה בפועל, ולכן היא נבדקת.
  it('walks back past skippable screens and stops at the first always-shown one', () => {
    // demog (index 5): b1 מותנה ולכן ניתן לדילוג, וכך גם a3/a2/a1; intro עוצר
    expect(ids(sequentialPredecessors(screens, 5))).toEqual(['b1', 'a3', 'a2', 'a1', 'intro']);
  });

  it('stops immediately when the previous screen is always shown', () => {
    expect(ids(sequentialPredecessors(screens, 1))).toEqual(['intro']);
  });

  it('skips a predecessor that always jumps elsewhere', () => {
    const withGoto = [info('a', { next: [{ goto: 'c' }] }), info('b', { showIf: inA }), info('c')];
    expect(ids(sequentialPredecessors(withGoto, 1))).toEqual([]);
  });

  it('never treats an end screen as falling through', () => {
    const afterEnd = [{ id: 'e', type: 'end', variant: 'complete', title: '', body: '' } as Screen, info('x')];
    expect(ids(sequentialPredecessors(afterEnd, 1))).toEqual([]);
  });

  it('lists every screen the flow could land on, not just the next one', () => {
    // מ-intro אפשר לנחות על a1, ואם הוא מדולג — על a2, וכן הלאה עד המסך
    // הראשון שמוצג תמיד
    expect(ids(sequentialSuccessors(screens, 0))).toEqual(['a1', 'a2', 'a3', 'b1', 'demog']);
    expect(ids(sequentialSuccessors(screens, 3))).toEqual(['b1', 'demog']);
  });
});
