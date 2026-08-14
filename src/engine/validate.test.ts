import { describe, expect, it } from 'vitest';
import { validateConfig } from './validate';
import type { Screen, SurveyConfig } from './types';
import { questionnaire } from '../questionnaire/placeholder';

const info = (id: string, extra: Partial<Screen> = {}): Screen =>
  ({ id, type: 'info', title: id, body: '', ...extra }) as Screen;

const end = (id: string): Screen => ({ id, type: 'end', variant: 'complete', title: '', body: '' });

const cfg = (screens: Screen[]): SurveyConfig => ({ version: 't', screens });

const errors = (c: SurveyConfig) => validateConfig(c).filter((i) => i.level === 'error');
const codes = (c: SurveyConfig) => validateConfig(c).map((i) => i.code);

describe('validateConfig', () => {
  it('the demo questionnaire validates clean', () => {
    expect(validateConfig(questionnaire)).toEqual([]);
  });

  it('empty config is an error', () => {
    expect(codes(cfg([]))).toEqual(['empty-config']);
  });

  it('detects duplicate ids', () => {
    expect(codes(cfg([info('a'), info('a'), end('e')]))).toContain('duplicate-id');
  });

  it('detects a dangling goto', () => {
    expect(codes(cfg([info('a', { next: [{ goto: 'nope' }] }), end('e')]))).toContain(
      'dangling-goto',
    );
  });

  it('detects a backward goto cycle closed by fall-through', () => {
    // b → goto a, a falls through to b: a → b → a
    const c = cfg([info('a'), info('b', { next: [{ goto: 'a' }] }), end('e')]);
    const cycle = validateConfig(c).find((i) => i.code === 'cycle');
    expect(cycle?.level).toBe('error');
    expect(cycle?.message).toContain('a');
  });

  it('no cycle when an unconditional goto skips past the backward edge', () => {
    // a jumps straight to end, so a→b fall-through never happens
    const c = cfg([
      info('a', { next: [{ goto: 'e' }] }),
      info('b', { next: [{ goto: 'a' }] }),
      end('e'),
    ]);
    expect(codes(c)).not.toContain('cycle');
    // b becomes unreachable — that is the correct diagnosis instead
    expect(codes(c)).toContain('unreachable');
  });

  it('detects a cycle through a skippable (showIf) screen between the endpoints', () => {
    // c → goto a; b has showIf so a can fall through past b directly to c
    const c = cfg([
      info('a'),
      info('b', { showIf: { q: 'a', op: 'answered' } }),
      info('c', { next: [{ if: { q: 'a', op: 'answered' }, goto: 'a' }] }),
      end('e'),
    ]);
    expect(codes(c)).toContain('cycle');
  });

  it('end screens emit no outgoing edges (no false cycle)', () => {
    const c = cfg([info('a'), end('e'), info('b', { next: [{ goto: 'a' }] })]);
    // a → e stops there; b is unreachable, and its backward goto is not a live cycle
    expect(codes(c)).not.toContain('cycle');
    expect(codes(c)).toContain('unreachable');
  });

  it('detects unknown question refs nested inside all/any/not', () => {
    const c = cfg([
      info('a', {
        showIf: undefined,
        next: [
          {
            if: { all: [{ not: { any: [{ q: 'ghost', op: 'answered' }] } }] },
            goto: 'e',
          },
        ],
      }),
      end('e'),
    ]);
    const issue = errors(c).find((i) => i.code === 'unknown-ref');
    expect(issue?.message).toContain('ghost');
  });

  it('detects unknown var refs but allows url_* and randomVars', () => {
    const bad = cfg([info('a'), info('b', { showIf: { var: 'segment', op: 'eq', value: 'A' } }), end('e')]);
    expect(codes(bad)).toContain('unknown-ref');

    const ok: SurveyConfig = {
      version: 't',
      randomVars: { price: [1, 2] },
      screens: [
        info('a'),
        info('b', { showIf: { var: 'price', op: 'eq', value: 1 } }),
        info('c', { showIf: { var: 'url_source', op: 'eq', value: 'fb' } }),
        end('e'),
      ],
    };
    expect(codes(ok)).not.toContain('unknown-ref');
  });

  it('first screen with showIf is an error', () => {
    const c = cfg([info('a', { showIf: { q: 'a', op: 'answered' } }), end('e')]);
    expect(codes(c)).toContain('first-screen-showif');
  });

  it('missing end screen / unreachable end are errors', () => {
    expect(codes(cfg([info('a')]))).toContain('no-end-screen');
    const c = cfg([info('a', { next: [{ goto: 'a2' }] }), info('a2'), end('e')]);
    expect(codes(c)).not.toContain('no-end-reachable');
  });

  it('warns on a var set only conditionally with no complementary rule', () => {
    const c = cfg([
      info('q1', {
        onSubmit: [{ var: 'seg', value: 'A', if: { q: 'q1', op: 'answered' } }],
      }),
      info('q2', { showIf: { var: 'seg', op: 'eq', value: 'A' } }),
      end('e'),
    ]);
    const issue = validateConfig(c).find((i) => i.code === 'var-totality');
    expect(issue?.level).toBe('warning');
  });

  it('no totality warning for a cond/not(cond) pair (placeholder B/C pattern)', () => {
    const rule = { q: 'q1', op: 'answered' } as const;
    const c = cfg([
      info('q1', {
        onSubmit: [
          { var: 'seg', value: 'B', if: rule },
          { var: 'seg', value: 'C', if: { not: rule } },
        ],
      }),
      info('q2', { showIf: { var: 'seg', op: 'eq', value: 'B' } }),
      end('e'),
    ]);
    expect(codes(c)).not.toContain('var-totality');
  });
});

// ── random variables and interpolation in screen text (ENG-19) ──

describe('validateConfig · random variables', () => {
  const withRandom = (randomVars: SurveyConfig['randomVars'], screens?: Screen[]): SurveyConfig => ({
    version: 't',
    randomVars,
    screens: screens ?? [info('a'), end('e')],
  });

  it('a draw with fewer than two values is an error', () => {
    for (const values of [[], [99]]) {
      const issue = errors(withRandom({ price: values })).find((i) => i.code === 'random-var-values');
      expect(issue?.message).toContain('price');
    }
    expect(codes(withRandom({ price: [99, 199] }))).not.toContain('random-var-values');
  });

  it('an empty value is an error — the respondent would read a hole', () => {
    const issue = errors(withRandom({ price: [99, '  '] })).find(
      (i) => i.code === 'random-var-values',
    );
    expect(issue?.message).toContain('ערך ריק');
  });

  it('a repeated value is a warning — it doubles that value’s odds', () => {
    const issue = validateConfig(withRandom({ price: [99, 199, 99] })).find(
      (i) => i.code === 'random-var-values',
    );
    expect(issue?.level).toBe('warning');
  });

  it('interpolating a name nothing produces is an error', () => {
    const screens = [info('a', { title: 'מחיר: {price}' }), end('e')];
    expect(codes(cfg(screens))).toContain('unknown-interpolation');
    expect(codes(withRandom({ price: [99, 199] }, screens))).not.toContain('unknown-interpolation');
  });

  it('interpolation accepts a mark, a url_* param and a question id', () => {
    const c = cfg([
      info('a', { onSubmit: [{ var: 'seg', value: 'A' }] }),
      { id: 'q1', type: 'number', prompt: 'גיל' },
      info('b', { title: '{seg} · {url_source} · {q1}' }),
      end('e'),
    ]);
    expect(codes(c)).not.toContain('unknown-interpolation');
  });

  it('reports each unknown name once per screen, in the fields the engine interpolates', () => {
    // help does not go through interpolate (see withInterpolation in App.tsx),
    // so a {ghost} there is not a broken reference but plain text
    const c = cfg([
      info('a', { title: '{ghost}', body: '{ghost} ושוב {ghost}' }),
      { id: 'q1', type: 'text', prompt: 'שאלה', help: '{ghost}' },
      end('e'),
    ]);
    const found = validateConfig(c).filter((i) => i.code === 'unknown-interpolation');
    expect(found).toHaveLength(1);
    expect(found[0].screenId).toBe('a');
  });
});

// ── quotas (ENG-20) ──

describe('validateConfig · quotas', () => {
  const quotaEnd = (id: string): Screen =>
    ({ id, type: 'end', variant: 'quotafull', title: 'מלא', body: '' }) as Screen;

  const withQuota = (limit: number, screens: Screen[]): SurveyConfig => ({
    version: 't',
    varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: limit } } },
    screens,
  });

  const setter = info('q1', { onSubmit: [{ var: 'persona', value: 'young_couple' }] });

  it('a quota with no quota-full end screen is an error', () => {
    const issue = errors(withQuota(50, [setter, end('e')])).find((i) => i.code === 'quota');
    expect(issue?.message).toContain('מסך סיום');
    expect(codes(withQuota(50, [setter, end('e'), quotaEnd('qf')]))).not.toContain('quota');
  });

  it('a quota on a value no screen can set is a warning', () => {
    const c = withQuota(50, [info('q1'), end('e'), quotaEnd('qf')]);
    const issue = validateConfig(c).find((i) => i.code === 'quota');
    expect(issue?.level).toBe('warning');
    expect(issue?.message).toContain('young_couple');
  });

  it('0 is a real quota — a closed cell — but a fraction or a negative is an error', () => {
    expect(codes(withQuota(0, [setter, end('e'), quotaEnd('qf')]))).not.toContain('quota');
    for (const bad of [-1, 2.5]) {
      expect(errors(withQuota(bad, [setter, end('e'), quotaEnd('qf')])).map((i) => i.code)).toContain(
        'quota',
      );
    }
  });

  it('a survey with no quotas at all needs no quota-full screen', () => {
    expect(codes(cfg([setter, end('e')]))).not.toContain('quota');
  });
});

// ── screen content integrity ──
// Every case here is a "legal" edit in the console that left the survey broken
// with no warning at all (QA report 2026-08-08, A7).

const single = (id: string, options: { id: string; label: string }[], extra: Partial<Screen> = {}): Screen =>
  ({ id, type: 'single', prompt: id, options, ...extra }) as Screen;

describe('validateConfig · content integrity', () => {
  it('a choice screen with no options is an error — the respondent is stuck', () => {
    const issue = errors(cfg([single('q', []), end('e')])).find((i) => i.code === 'no-choices');
    expect(issue?.message).toContain('ייתקע');
  });

  it('empty and duplicate option ids are errors', () => {
    const c = cfg([
      single('q', [
        { id: 'a', label: 'A' },
        { id: '', label: 'blank id' },
        { id: 'a', label: 'dup' },
      ]),
      end('e'),
    ]);
    expect(codes(c)).toContain('empty-choice-id');
    expect(codes(c)).toContain('duplicate-choice-id');
  });

  it('a screen with no prompt / no title is an error', () => {
    expect(codes(cfg([single('q', [{ id: 'a', label: 'A' }], { prompt: '  ' }), end('e')]))).toContain(
      'empty-text',
    );
    expect(codes(cfg([info('a', { title: '' }), end('e')]))).toContain('empty-text');
  });

  it('an option with no label is an error', () => {
    expect(codes(cfg([single('q', [{ id: 'a', label: '' }]), end('e')]))).toContain('empty-text');
  });

  it('a consent screen with a blank button label is an error', () => {
    const c = cfg([
      { id: 'c', type: 'consent', title: 'T', body: '', agreeLabel: 'כן', declineLabel: '' },
      end('e'),
    ]);
    expect(codes(c)).toContain('empty-text');
  });

  it('an inverted matrix scale is an error, a single-value scale is a warning', () => {
    const matrix = (scaleMin: number, scaleMax: number): Screen => ({
      id: 'm',
      type: 'matrix',
      prompt: 'p',
      items: [{ id: 'i', label: 'I' }],
      scaleMin,
      scaleMax,
      minLabel: 'a',
      maxLabel: 'b',
    });
    const inverted = validateConfig(cfg([matrix(5, 1), end('e')])).find((i) => i.code === 'scale-range');
    expect(inverted?.level).toBe('error');
    const degenerate = validateConfig(cfg([matrix(3, 3), end('e')])).find(
      (i) => i.code === 'scale-range',
    );
    expect(degenerate?.level).toBe('warning');
    expect(codes(cfg([matrix(1, 5), end('e')]))).not.toContain('scale-range');
  });

  it('a matrix with no items is an error', () => {
    const c = cfg([
      {
        id: 'm',
        type: 'matrix',
        prompt: 'p',
        items: [],
        scaleMin: 1,
        scaleMax: 5,
        minLabel: 'a',
        maxLabel: 'b',
      },
      end('e'),
    ]);
    expect(codes(c)).toContain('no-choices');
  });

  it('maxSelections of 0 or a negative number is an error, not "unlimited"', () => {
    const multi = (maxSelections: number): Screen => ({
      id: 'q',
      type: 'multi',
      prompt: 'p',
      maxSelections,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(errors(cfg([multi(0), end('e')])).map((i) => i.code)).toContain('bad-max-selections');
    expect(errors(cfg([multi(-1), end('e')])).map((i) => i.code)).toContain('bad-max-selections');
    // A cap that is not below the number of options breaks nothing — it is merely pointless
    const pointless = validateConfig(cfg([multi(2), end('e')])).find(
      (i) => i.code === 'bad-max-selections',
    );
    expect(pointless?.level).toBe('warning');
    expect(codes(cfg([multi(1), end('e')]))).not.toContain('bad-max-selections');
  });

  it('a text limit of 0 or a negative number is an error', () => {
    const text = (maxLength: number): Screen => ({ id: 't', type: 'text', prompt: 'p', maxLength });
    for (const bad of [0, -10, 2.5]) {
      expect(errors(cfg([text(bad), end('e')])).map((i) => i.code)).toContain('bad-text-limit');
    }
    expect(codes(cfg([text(500), end('e')]))).not.toContain('bad-text-limit');
  });

  it('a condition whose value is not one of the target screen options is an error', () => {
    const c = cfg([
      single('q1', [
        { id: 'yes', label: 'Y' },
        { id: 'no', label: 'N' },
      ]),
      info('q2', { showIf: { q: 'q1', op: 'eq', value: 'maybe' } }),
      end('e'),
    ]);
    const issue = errors(c).find((i) => i.code === 'unknown-option');
    expect(issue?.message).toContain('maybe');
    expect(issue?.message).toContain('המסלול הזה לעולם לא ייפתח');
  });

  it('checks every member of an "in" list, and reports ne as always-true', () => {
    const c = cfg([
      single('q1', [{ id: 'yes', label: 'Y' }]),
      info('q2', { showIf: { q: 'q1', op: 'in', value: ['yes', 'ghost'] } }),
      info('q3', { showIf: { q: 'q1', op: 'ne', value: 'ghost' } }),
      end('e'),
    ]);
    const found = validateConfig(c).filter((i) => i.code === 'unknown-option');
    expect(found).toHaveLength(2);
    expect(found[1].message).toContain('התנאי יתקיים אצל כל משיב');
  });

  it('does not flag conditions against screens that have no options', () => {
    const c = cfg([
      { id: 'n', type: 'number', prompt: 'age' },
      info('q2', { showIf: { q: 'n', op: 'lt', value: 18 } }),
      end('e'),
    ]);
    expect(codes(c)).not.toContain('unknown-option');
  });
});

// ── variable ordering (A8) ──

describe('validateConfig · variable ordering', () => {
  const producer = (id: string): Screen =>
    info(id, { onSubmit: [{ var: 'seg', value: 'A' }] });
  const consumer = (id: string): Screen => info(id, { showIf: { var: 'seg', op: 'eq', value: 'A' } });

  it('warns when the conditional screen comes before the screen that sets the variable', () => {
    const c = cfg([info('start'), consumer('q2'), producer('q1'), end('e')]);
    const issue = validateConfig(c).find((i) => i.code === 'var-order');
    expect(issue?.level).toBe('warning');
    expect(issue?.screenId).toBe('q2');
  });

  it('is silent in the correct order', () => {
    expect(codes(cfg([info('start'), producer('q1'), consumer('q2'), end('e')]))).not.toContain(
      'var-order',
    );
  });

  it('a screen may use in next[] a variable its own onSubmit sets', () => {
    // onSubmit runs before findNext on the same ctx, so this is fine and must not be flagged
    const c = cfg([
      info('start'),
      info('q1', {
        onSubmit: [{ var: 'seg', value: 'A' }],
        next: [{ if: { var: 'seg', op: 'eq', value: 'A' }, goto: 'e' }],
      }),
      end('e'),
    ]);
    expect(codes(c)).not.toContain('var-order');
  });

  it('a screen may not use in its own showIf a variable only it sets', () => {
    const c = cfg([
      info('start'),
      info('q1', {
        onSubmit: [{ var: 'seg', value: 'A' }],
        showIf: { var: 'seg', op: 'eq', value: 'A' },
      }),
      end('e'),
    ]);
    expect(codes(c)).toContain('var-order');
  });

  it('one producer before the consumer is enough, even with more after', () => {
    const c = cfg([producer('q0'), consumer('q1'), producer('q2'), end('e')]);
    expect(codes(c)).not.toContain('var-order');
  });

  it('randomVars and url_* are never flagged', () => {
    const c: SurveyConfig = {
      version: 't',
      randomVars: { price: [1, 2] },
      screens: [
        info('a'),
        info('b', { showIf: { var: 'price', op: 'eq', value: 1 } }),
        info('c', { showIf: { var: 'url_source', op: 'eq', value: 'fb' } }),
        end('e'),
      ],
    };
    expect(codes(c)).not.toContain('var-order');
  });

  it('the real questionnaire and the demo stay clean under every new check', async () => {
    const { questionnaire: real } = await import('../questionnaire/survey-v1');
    expect(validateConfig(real)).toEqual([]);
    expect(validateConfig(questionnaire)).toEqual([]);
  });
});
