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
