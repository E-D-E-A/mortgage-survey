import { describe, expect, it } from 'vitest';
import { duplicateScreen, insertScreen, nextChoiceId, sameShape, uniqueId } from './edits';
import { validateConfig } from '../engine/validate';
import type { Screen, SurveyConfig } from '../engine/types';

const info = (id: string, extra: Partial<Screen> = {}): Screen =>
  ({ id, type: 'info', title: id, body: 'גוף', ...extra }) as Screen;

const end = (id: string): Screen => ({ id, type: 'end', variant: 'complete', title: 'ת', body: 'ב' });

const base = [info('q1'), info('q2'), end('end_complete'), end('end_screenout')];
const added = info('new');
const ids = (screens: Screen[]) => screens.map((s) => s.id);

describe('insertScreen', () => {
  it('inserts right after the selected screen', () => {
    expect(ids(insertScreen(base, added, 'q1'))).toEqual([
      'q1',
      'new',
      'q2',
      'end_complete',
      'end_screenout',
    ]);
  });

  it('inserts before the first end screen when nothing is selected', () => {
    // The original bug: the screen landed at position 71 of 71, after the end
    // screens, and immediately drew an "unreachable from the first screen" warning
    expect(ids(insertScreen(base, added, null))).toEqual([
      'q1',
      'q2',
      'new',
      'end_complete',
      'end_screenout',
    ]);
  });

  it('does not land after the end screens when an end screen is selected', () => {
    expect(ids(insertScreen(base, added, 'end_complete'))).toEqual([
      'q1',
      'q2',
      'new',
      'end_complete',
      'end_screenout',
    ]);
  });

  it('appends a new end screen instead of stealing the existing end fall-through', () => {
    const newEnd = end('end_quota');
    expect(ids(insertScreen(base, newEnd, 'q1'))).toEqual([
      'q1',
      'q2',
      'end_complete',
      'end_screenout',
      'end_quota',
    ]);
  });

  it('appends when there is no end screen at all', () => {
    expect(ids(insertScreen([info('q1')], added, null))).toEqual(['q1', 'new']);
  });

  it('ignores a selected id that no longer exists', () => {
    expect(ids(insertScreen(base, added, 'ghost'))).toEqual([
      'q1',
      'q2',
      'new',
      'end_complete',
      'end_screenout',
    ]);
  });

  it('the added screen is reachable — the warning the old behaviour always produced', () => {
    // (end_screenout in base genuinely is unreachable; only the added screen is of interest here)
    for (const selected of [null, 'q1', 'end_complete']) {
      const cfg: SurveyConfig = { version: 't', screens: insertScreen(base, added, selected) };
      const unreachable = validateConfig(cfg).filter((i) => i.code === 'unreachable');
      expect(unreachable.map((i) => i.screenId)).not.toContain('new');
    }
  });

  it('does not mutate the input array', () => {
    const before = ids(base);
    insertScreen(base, added, 'q1');
    expect(ids(base)).toEqual(before);
  });
});

describe('duplicateScreen', () => {
  const withRouting = info('seg', {
    showIf: { var: 'x', op: 'eq', value: 1 },
    next: [{ goto: 'end_complete' }],
    onSubmit: [{ var: 'segment', value: 'A' }],
  });

  it('places the copy right after the original with a free id', () => {
    const out = duplicateScreen([withRouting, end('end_complete')], 'seg');
    expect(ids(out)).toEqual(['seg', 'seg_2', 'end_complete']);
  });

  it('drops next and onSubmit but keeps showIf and the content', () => {
    // Two screens assigning the same segment is exactly the situation that is hard to notice
    const copy = duplicateScreen([withRouting, end('end_complete')], 'seg')[1];
    expect(copy.onSubmit).toBeUndefined();
    expect(copy.next).toBeUndefined();
    expect(copy.showIf).toEqual({ var: 'x', op: 'eq', value: 1 });
    expect((copy as { title: string }).title).toBe('seg');
  });

  it('deep-copies the content so editing the copy leaves the original alone', () => {
    const single: Screen = {
      id: 'q',
      type: 'single',
      prompt: 'p',
      options: [{ id: 'a', label: 'A' }],
    };
    const out = duplicateScreen([single, end('e')], 'q');
    (out[1] as typeof single).options[0].label = 'שונה';
    expect((out[0] as typeof single).options[0].label).toBe('A');
  });

  it('is a no-op for an unknown id', () => {
    expect(duplicateScreen(base, 'ghost')).toBe(base);
  });
});

describe('uniqueId', () => {
  it('returns the base when free, and suffixes otherwise', () => {
    expect(uniqueId('q_2', base)).toBe('q_2');
    expect(uniqueId('q1', base)).toBe('q1_2');
    expect(uniqueId('q1', [...base, info('q1_2'), info('q1_3')])).toBe('q1_4');
  });
});

describe('nextChoiceId', () => {
  const opts = (...ids: string[]) => ids.map((id) => ({ id }));

  it('continues the series on a list that was never edited', () => {
    expect(nextChoiceId('opt', opts('opt_1', 'opt_2'))).toBe('opt_3');
    expect(nextChoiceId('item', [])).toBe('item_1');
  });

  it('skips a code that is still in use after a middle row was deleted', () => {
    // opt_1..opt_3 minus opt_1: counting by length would hand back opt_3 again
    expect(nextChoiceId('opt', opts('opt_2', 'opt_3'))).toBe('opt_4');
  });

  it('fills a gap rather than climbing forever', () => {
    expect(nextChoiceId('opt', opts('opt_1', 'opt_3', 'opt_4'))).toBe('opt_5');
    expect(nextChoiceId('opt', opts('opt_5', 'opt_6'))).toBe('opt_3');
  });

  it('ignores codes that are not part of the series', () => {
    expect(nextChoiceId('opt', opts('active', 'past5', 'none'))).toBe('opt_4');
  });
});

describe('sameShape', () => {
  const screen = (opts: unknown[], prompt = 'a') => ({ id: 'q', type: 'single', prompt, options: opts });

  it('treats typing in a field as the same shape', () => {
    expect(sameShape(screen([{ id: 'o1', label: 'a' }]), screen([{ id: 'o1', label: 'ab' }]))).toBe(true);
  });

  it('treats adding or removing a row as a different shape', () => {
    const one = screen([{ id: 'o1', label: '' }]);
    const two = screen([{ id: 'o1', label: '' }, { id: 'o2', label: '' }]);
    expect(sameShape(one, two)).toBe(false);
    expect(sameShape(two, one)).toBe(false);
  });

  it('treats adding or removing an optional field as a different shape', () => {
    expect(sameShape({ id: 'q', help: 'x' }, { id: 'q' })).toBe(false);
    expect(sameShape({ id: 'q' }, { id: 'q', help: 'x' })).toBe(false);
  });

  it('treats a renamed field as a different shape', () => {
    expect(sameShape({ min: 1 }, { max: 1 })).toBe(false);
  });

  it('treats a type swap on a leaf as a different shape', () => {
    expect(sameShape({ v: 1 }, { v: '1' })).toBe(false);
    expect(sameShape({ v: true }, { v: false })).toBe(true);
  });

  it('does not confuse null with an object or with undefined', () => {
    expect(sameShape({ showIf: null }, { showIf: {} })).toBe(false);
    expect(sameShape({ showIf: null }, { showIf: null })).toBe(true);
  });

  it('compares nested conditions structurally', () => {
    const a = { showIf: { all: [{ q: 'x', op: 'eq', value: 'a' }] } };
    const b = { showIf: { all: [{ q: 'x', op: 'eq', value: 'b' }] } };
    const c = { showIf: { all: [{ q: 'x', op: 'eq', value: 'a' }, { q: 'y', op: 'eq', value: 'b' }] } };
    expect(sameShape(a, b)).toBe(true);
    expect(sameShape(a, c)).toBe(false);
  });
});
