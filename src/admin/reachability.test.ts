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
  // הפאנל טוען "מגיעים לכאן מ־X" — טענה על הזרימה בפועל, ולכן היא נבדקת.
  it('lists only the screens that can really land here, nearest first', () => {
    // a1/a2 אינם ברשימה: מ-a1 המסך a2 ודאי (אותו תנאי בדיוק), ולכן משם אי
    // אפשר לנחות על demog בכלל — זה בדיוק העומס שהגיזום מסיר
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
    // מ-intro: ראש ענף A, ראש ענף B, ואז המסך הראשון שמוצג תמיד
    expect(ids(fallThroughTargets(screens, 0))).toEqual(['a1', 'b1', 'demog']);
    // מ-a3 (segment=A): ענף B נגזם, ונשאר רק המסך שמוצג תמיד
    expect(ids(fallThroughTargets(screens, 3))).toEqual(['demog']);
  });

  it('stops as soon as the next screen is certain', () => {
    // a2 חולק תנאי זהה עם a1, ולכן אם a1 הוצג — a2 יוצג. אין המשך אחר.
    expect(ids(fallThroughTargets(screens, 1))).toEqual(['a2']);
  });

  it('drops a branch whose condition contradicts the source', () => {
    // מ-a3 (segment=A) אי אפשר לנחות על b1 (segment=B)
    expect(ids(fallThroughTargets(screens, 3))).not.toContain('b1');
  });
});
