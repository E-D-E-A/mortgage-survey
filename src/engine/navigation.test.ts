import { describe, expect, it } from 'vitest';
import { findNext } from './navigation';
import type { Answers, SurveyConfig, SurveyContext, Vars } from './types';

const ctx = (answers: Answers, vars: Vars = {}): SurveyContext => ({ answers, vars });

const config: SurveyConfig = {
  version: 'test',
  screens: [
    { id: 'a', type: 'info', title: 'א', body: '' },
    {
      id: 'b',
      type: 'number',
      prompt: 'גיל?',
      next: [{ if: { q: 'b', op: 'lt', value: 18 }, goto: 'end' }],
    },
    {
      id: 'c',
      type: 'single',
      showIf: { q: 'b', op: 'gte', value: 30 },
      prompt: '?',
      options: [{ id: 'x', label: 'x' }],
    },
    { id: 'd', type: 'text', prompt: '?' },
    { id: 'end', type: 'end', variant: 'complete', title: 'סוף', body: '' },
  ],
};

const at = (id: string) => config.screens.find((s) => s.id === id)!;

describe('findNext', () => {
  it('goto rule wins over array order when its condition holds', () => {
    expect(findNext(config, at('b'), ctx({ b: 16 }))?.id).toBe('end');
  });

  it('conditional goto falls through to array scan when condition fails', () => {
    expect(findNext(config, at('b'), ctx({ b: 35 }))?.id).toBe('c');
  });

  it('skips screens whose showIf fails', () => {
    expect(findNext(config, at('b'), ctx({ b: 25 }))?.id).toBe('d');
  });

  it('unconditional goto always wins', () => {
    const cfg: SurveyConfig = {
      version: 't',
      screens: [
        { id: 'a', type: 'info', title: '', body: '', next: [{ goto: 'end' }] },
        { id: 'b', type: 'text', prompt: '?' },
        { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
      ],
    };
    expect(findNext(cfg, cfg.screens[0], ctx({}))?.id).toBe('end');
  });

  it('returns null past the end of the array', () => {
    expect(findNext(config, at('end'), ctx({}))).toBeNull();
  });

  it('returns null for a dangling goto target', () => {
    const cfg: SurveyConfig = {
      version: 't',
      screens: [{ id: 'a', type: 'info', title: '', body: '', next: [{ goto: 'missing' }] }],
    };
    expect(findNext(cfg, cfg.screens[0], ctx({}))).toBeNull();
  });
});
