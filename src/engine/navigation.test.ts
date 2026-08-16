import { describe, expect, it } from 'vitest';
import { findNext } from './navigation';
import { quotaFullVar } from './quota';
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

// ── automatic routing on a full quota (ENG-21) ──

describe('findNext · full quotas', () => {
  const quotaCfg = (extra: Partial<SurveyConfig> = {}): SurveyConfig => ({
    version: 't',
    varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 50 } } },
    screens: [
      {
        id: 'q1',
        type: 'single',
        prompt: '?',
        options: [{ id: 'x', label: 'x' }],
        onSubmit: [{ var: 'persona', value: 'young_couple' }],
      },
      { id: 'q2', type: 'text', prompt: '?' },
      { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
      { id: 'full', type: 'end', variant: 'quotafull', title: '', body: '' },
      { id: 'out', type: 'end', variant: 'screenout', title: '', body: '' },
    ],
    ...extra,
  });

  const full: Vars = { persona: 'young_couple', [quotaFullVar('persona', 'young_couple')]: true };
  const first = (cfg: SurveyConfig) => cfg.screens[0];

  it('routes to the quota-full screen right after the screen that fills it', () => {
    const cfg = quotaCfg();
    expect(findNext(cfg, first(cfg), ctx({}, full))?.id).toBe('full');
  });

  it('carries on normally while the quota is open', () => {
    const cfg = quotaCfg();
    expect(findNext(cfg, first(cfg), ctx({}, { persona: 'young_couple' }))?.id).toBe('q2');
  });

  it('leaves alone a respondent marked with some other value', () => {
    const cfg = quotaCfg();
    const vars: Vars = { persona: 'upgrader', [quotaFullVar('persona', 'young_couple')]: true };
    expect(findNext(cfg, first(cfg), ctx({}, vars))?.id).toBe('q2');
  });

  it('does not fire on later screens that never set the value', () => {
    const cfg = quotaCfg();
    expect(findNext(cfg, cfg.screens[1], ctx({}, full))?.id).toBe('end');
  });

  it('overrides an ordinary goto rule — the admin writes no rule for this', () => {
    const cfg = quotaCfg();
    cfg.screens[0] = { ...cfg.screens[0], next: [{ goto: 'end' }] };
    expect(findNext(cfg, first(cfg), ctx({}, full))?.id).toBe('full');
  });

  it('yields to an explicit screenout — "not qualified" is the stronger statement', () => {
    const cfg = quotaCfg();
    cfg.screens[0] = { ...cfg.screens[0], next: [{ goto: 'out' }] };
    expect(findNext(cfg, first(cfg), ctx({}, full))?.id).toBe('out');
  });

  it('with no quota-full screen the respondent simply carries on', () => {
    const cfg = quotaCfg();
    cfg.screens = cfg.screens.filter((s) => s.id !== 'full');
    expect(findNext(cfg, first(cfg), ctx({}, full))?.id).toBe('q2');
  });
});
