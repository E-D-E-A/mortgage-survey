import { describe, expect, it } from 'vitest';
import { evaluate, interpolate } from './conditions';
import type { SurveyContext } from './types';

const ctx = (answers: SurveyContext['answers'], vars: SurveyContext['vars'] = {}): SurveyContext => ({
  answers,
  vars,
});

describe('evaluate', () => {
  it('eq / ne on answers and vars', () => {
    expect(evaluate({ q: 'a', op: 'eq', value: 'yes' }, ctx({ a: 'yes' }))).toBe(true);
    expect(evaluate({ q: 'a', op: 'ne', value: 'yes' }, ctx({ a: 'no' }))).toBe(true);
    expect(evaluate({ var: 'segment', op: 'eq', value: 'B' }, ctx({}, { segment: 'B' }))).toBe(true);
  });

  it('numeric comparisons', () => {
    expect(evaluate({ q: 'age', op: 'lt', value: 18 }, ctx({ age: 17 }))).toBe(true);
    expect(evaluate({ q: 'age', op: 'gte', value: 18 }, ctx({ age: 18 }))).toBe(true);
    expect(evaluate({ q: 'age', op: 'lt', value: 18 }, ctx({ age: null }))).toBe(false);
  });

  it('in / includes / includesAny', () => {
    expect(evaluate({ q: 't', op: 'in', value: ['m0_3', 'm4_6'] }, ctx({ t: 'm4_6' }))).toBe(true);
    expect(evaluate({ q: 'acts', op: 'includes', value: 'bank' }, ctx({ acts: ['bank', 'budget'] }))).toBe(true);
    expect(
      evaluate({ q: 'acts', op: 'includesAny', value: ['bank', 'advisor'] }, ctx({ acts: ['budget'] })),
    ).toBe(false);
  });

  it('answered treats null/empty as not answered', () => {
    expect(evaluate({ q: 'x', op: 'answered' }, ctx({ x: null }))).toBe(false);
    expect(evaluate({ q: 'x', op: 'answered' }, ctx({ x: [] }))).toBe(false);
    expect(evaluate({ q: 'x', op: 'answered' }, ctx({ x: 0 }))).toBe(true);
  });

  it('compound segment-B rule: timeline within 12m AND at least one real action', () => {
    const rule = {
      all: [
        { q: 's_timeline', op: 'in', value: ['m0_3', 'm4_6', 'm7_12'] } as const,
        { q: 's_actions', op: 'includesAny', value: ['budget', 'bank', 'advisor', 'approval'] } as const,
      ],
    };
    expect(evaluate(rule, ctx({ s_timeline: 'm4_6', s_actions: ['bank'] }))).toBe(true);
    expect(evaluate(rule, ctx({ s_timeline: 'm4_6', s_actions: ['none'] }))).toBe(false);
    expect(evaluate(rule, ctx({ s_timeline: 'm13_24', s_actions: ['bank'] }))).toBe(false);
  });

  it('not / any nesting', () => {
    expect(
      evaluate(
        { not: { any: [{ q: 'a', op: 'eq', value: 1 }, { q: 'b', op: 'eq', value: 2 }] } },
        ctx({ a: 3, b: 3 }),
      ),
    ).toBe(true);
  });
});

describe('interpolate', () => {
  it('substitutes vars and leaves unknown placeholders intact', () => {
    expect(interpolate('המחיר הוא {price} ש"ח', ctx({}, { price: 149 }))).toBe('המחיר הוא 149 ש"ח');
    expect(interpolate('ללא {missing}', ctx({}))).toBe('ללא {missing}');
  });
});
