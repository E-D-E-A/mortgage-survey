import { describe, expect, it } from 'vitest';
import { findNext } from './navigation';
import { quotaFullVar, quotaVars } from './quota';
import type { Answers, Screen, SurveyConfig, SurveyContext, Vars } from './types';

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

  it('a session keeps the flags it came in with — a cell that fills later cannot throw it out', () => {
    // The promise behind fetching the quota state once, on entry: a respondent
    // who started while the cell was open finishes the survey they started.
    const cfg = quotaCfg();
    const atEntry = ctx({}, {
      persona: 'young_couple',
      ...quotaVars(cfg, { persona: { young_couple: 49 } }),
    });
    expect(findNext(cfg, first(cfg), atEntry)?.id).toBe('q2');

    // The last slot goes to someone else while this respondent is mid-survey
    quotaVars(cfg, { persona: { young_couple: 50 } });
    expect(atEntry.vars).not.toHaveProperty(quotaFullVar('persona', 'young_couple'));
    expect(findNext(cfg, first(cfg), atEntry)?.id).toBe('q2');
  });

  it('a flag for a value the respondent no longer holds does not fire', () => {
    // Both rules run, the unconditional one last, so the respondent leaves the
    // screen an owner. The check reads the vars after every rule has run, which
    // is why the stale young_couple flag has nothing to catch.
    const cfg = quotaCfg();
    cfg.screens[0] = {
      ...cfg.screens[0],
      onSubmit: [
        { var: 'persona', value: 'young_couple' },
        { var: 'persona', value: 'owner' },
      ],
    } as Screen;
    const vars: Vars = { persona: 'owner', [quotaFullVar('persona', 'young_couple')]: true };
    expect(findNext(cfg, first(cfg), ctx({}, vars))?.id).toBe('q2');
  });

  it('a cell closed at 0 turns the very first respondent away, before anyone has finished', () => {
    const cfg = quotaCfg({ varMeta: { persona: { label: 'פרסונה', quotas: { young_couple: 0 } } } });
    const closed = quotaVars(cfg, {});
    expect(closed).toEqual({ [quotaFullVar('persona', 'young_couple')]: true });
    expect(findNext(cfg, first(cfg), ctx({}, { persona: 'young_couple', ...closed }))?.id).toBe(
      'full',
    );
  });

  it('a value with no ceiling never routes anywhere, however many have finished with it', () => {
    const cfg = quotaCfg();
    const none = quotaVars(cfg, { persona: { upgrader: 999_999 } });
    expect(none).toEqual({});
    expect(findNext(cfg, first(cfg), ctx({}, { persona: 'upgrader', ...none }))?.id).toBe('q2');
  });

  it('a numeric mark value routes through the flag keyed by its text form', () => {
    const cfg: SurveyConfig = {
      version: 't',
      varMeta: { age_bracket: { label: 'קבוצת גיל', quotas: { '25': 1 } } },
      screens: [
        { id: 'q1', type: 'info', title: '', body: '', onSubmit: [{ var: 'age_bracket', value: 25 }] },
        { id: 'q2', type: 'text', prompt: '?' },
        { id: 'full', type: 'end', variant: 'quotafull', title: '', body: '' },
      ],
    };
    const closed = quotaVars(cfg, { age_bracket: { '25': 1 } });
    expect(closed).toEqual({ [quotaFullVar('age_bracket', 25)]: true });
    expect(findNext(cfg, cfg.screens[0], ctx({}, { age_bracket: 25, ...closed }))?.id).toBe('full');
  });
});

// ── one respondent, several capped marks (ENG-21) ──

describe('findNext · more than one quota on the same respondent', () => {
  const twoMarks = (): SurveyConfig => ({
    version: 't',
    varMeta: {
      persona: { label: 'פרסונה', quotas: { young_couple: 50 } },
      city: { label: 'עיר', quotas: { tel_aviv: 20 } },
    },
    screens: [
      {
        id: 'q1',
        type: 'single',
        prompt: '?',
        options: [{ id: 'x', label: 'x' }],
        onSubmit: [
          { var: 'persona', value: 'young_couple' },
          { var: 'city', value: 'tel_aviv' },
        ],
      },
      { id: 'q2', type: 'text', prompt: '?' },
      { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
      { id: 'full', type: 'end', variant: 'quotafull', title: '', body: '' },
    ],
  });

  const held: Vars = { persona: 'young_couple', city: 'tel_aviv' };

  it('one cell full and the other open is still a full quota', () => {
    const cfg = twoMarks();
    const vars = { ...held, ...quotaVars(cfg, { persona: { young_couple: 50 }, city: { tel_aviv: 5 } }) };
    expect(findNext(cfg, cfg.screens[0], ctx({}, vars))?.id).toBe('full');
  });

  it('both cells full route to the one quota-full screen, not twice', () => {
    const cfg = twoMarks();
    const vars = { ...held, ...quotaVars(cfg, { persona: { young_couple: 50 }, city: { tel_aviv: 20 } }) };
    expect(findNext(cfg, cfg.screens[0], ctx({}, vars))?.id).toBe('full');
  });

  it('a full cell on a mark the respondent holds a different value for leaves them alone', () => {
    const cfg = twoMarks();
    const vars: Vars = {
      persona: 'young_couple',
      city: 'haifa',
      ...quotaVars(cfg, { city: { tel_aviv: 20 } }),
    };
    expect(findNext(cfg, cfg.screens[0], ctx({}, vars))?.id).toBe('q2');
  });
});
