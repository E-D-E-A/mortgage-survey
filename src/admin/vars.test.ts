import { describe, expect, it } from 'vitest';
import { validateConfig } from '../engine/validate';
import type { Screen, SurveyConfig } from '../engine/types';
import {
  addRandomValue,
  addRandomVar,
  defineVar,
  defineVarValue,
  marks,
  parseRandomValue,
  removeRandomValueAt,
  removeRandomVar,
  renameVar,
  renameVarValue,
  setQuota,
  setRandomValueAt,
  setVarValueLabel,
  varReferences,
} from './vars';

const info = (id: string, extra: Partial<Screen> = {}): Screen =>
  ({ id, type: 'info', title: id, body: '', ...extra }) as Screen;

const base: SurveyConfig = { version: 't', screens: [info('a'), info('b')] };

describe('parseRandomValue', () => {
  it('keeps numbers numeric so numeric conditions keep working', () => {
    expect(parseRandomValue(' 79 ')).toBe(79);
    expect(parseRandomValue('-3.5')).toBe(-3.5);
  });

  it('leaves anything else as text', () => {
    expect(parseRandomValue('גרסה א')).toBe('גרסה א');
    expect(parseRandomValue('79a')).toBe('79a');
  });
});

describe('random variable edits', () => {
  it('a new draw starts with one empty slot and a label', () => {
    // One and not two: two empty slots are duplicates of each other, and both
    // rows would key their label off the same empty string
    const next = addRandomVar(base, 'price', 'מחיר לניסוי');
    expect(next.randomVars).toEqual({ price: [''] });
    expect(next.varMeta?.price.label).toBe('מחיר לניסוי');
  });

  it('editing a value carries its label with it', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');
    cfg = setRandomValueAt(cfg, 'price', 0, 149);

    expect(cfg.randomVars?.price).toEqual([149]);
    expect(cfg.varMeta?.price.values).toEqual({ '149': 'הזול' });
  });

  it('deleting a value takes its label, and adding one appends an empty slot', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = addRandomValue(cfg, 'price');
    cfg = setRandomValueAt(cfg, 'price', 1, 199);
    cfg = setVarValueLabel(cfg, 'price', '199', 'היקר');
    cfg = addRandomValue(cfg, 'price');
    expect(cfg.randomVars?.price).toEqual([99, 199, '']);

    cfg = removeRandomValueAt(cfg, 'price', 1);
    expect(cfg.randomVars?.price).toEqual([99, '']);
    expect(cfg.varMeta?.price.values).toEqual({});
  });

  it('a duplicated value keeps its label until the last copy is gone', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = addRandomValue(cfg, 'price');
    cfg = setRandomValueAt(cfg, 'price', 1, 99);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');

    cfg = removeRandomValueAt(cfg, 'price', 1);
    expect(cfg.varMeta?.price.values).toEqual({ '99': 'הזול' });
  });

  it('naming a value leaves the mark’s quotas alone', () => {
    // The regression this guards: VarMeta was rebuilt from label+values, so
    // naming a value dropped every quota on the mark. Nothing complained —
    // with no quotas left there is nothing to validate — and the survey
    // published with the cap gone.
    let cfg = setQuota(base, 'persona', 'young_couple', 50);
    cfg = defineVarValue(cfg, 'persona', 'upgrader', 'משפרי דיור');
    expect(cfg.varMeta?.persona.quotas).toEqual({ young_couple: 50 });

    cfg = setVarValueLabel(cfg, 'persona', 'upgrader', 'שם אחר');
    expect(cfg.varMeta?.persona.quotas).toEqual({ young_couple: 50 });
  });

  it('editing a row into a value another row already holds keeps both labels put', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = addRandomValue(cfg, 'price');
    cfg = setRandomValueAt(cfg, 'price', 1, 199);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');
    cfg = setVarValueLabel(cfg, 'price', '199', 'היקר');

    // Row 1 becomes 99 as well: 99 already has a name, and it is not row 1's to take
    cfg = setRandomValueAt(cfg, 'price', 1, 99);
    expect(cfg.varMeta?.price.values).toEqual({ '99': 'הזול' });
  });

  it('a label stays behind while another row still holds its value', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = addRandomValue(cfg, 'price');
    cfg = setRandomValueAt(cfg, 'price', 1, 99);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');

    cfg = setRandomValueAt(cfg, 'price', 1, 149);
    expect(cfg.randomVars?.price).toEqual([99, 149]);
    expect(cfg.varMeta?.price.values).toEqual({ '99': 'הזול' });
  });

  it('an emptied label is removed, not stored blank', () => {
    let cfg = defineVarValue(base, 'seg', 'A', 'מסלול א');
    cfg = setVarValueLabel(cfg, 'seg', 'A', '   ');
    expect(cfg.varMeta?.seg.values).toEqual({});
  });

  it('deleting a draw takes its labels and drops the empty maps entirely', () => {
    const cfg = addRandomVar(base, 'price', 'מחיר');
    const next = removeRandomVar(cfg, 'price');
    expect(next.randomVars).toBeUndefined();
    expect(next.varMeta).toBeUndefined();
  });

  it('deleting one draw leaves the others alone', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = addRandomVar(cfg, 'copy', 'נוסח');
    cfg = defineVar(cfg, 'seg', 'מסלול');

    const next = removeRandomVar(cfg, 'price');
    expect(Object.keys(next.randomVars ?? {})).toEqual(['copy']);
    expect(Object.keys(next.varMeta ?? {})).toEqual(['copy', 'seg']);
  });
});

describe('marks', () => {
  it('lists mark values from varMeta and from onSubmit rules alike', () => {
    const cfg: SurveyConfig = {
      version: 't',
      varMeta: { persona: { label: 'פרסונה', values: { young_couple: 'זוג צעיר' } } },
      screens: [
        info('a', {
          onSubmit: [
            { var: 'persona', value: 'upgrader' },
            { var: 'persona', value: 'young_couple' },
          ],
        }),
      ],
    };
    expect(marks(cfg)).toEqual([{ name: 'persona', values: ['young_couple', 'upgrader'] }]);
  });

  it('leaves out draws and url_* — neither is set by a screen', () => {
    const cfg: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      varMeta: { price: { label: 'מחיר' }, seg: { label: 'מסלול' } },
      screens: [info('a', { onSubmit: [{ var: 'url_source', value: 'fb' }] })],
    };
    expect(marks(cfg).map((m) => m.name)).toEqual(['seg']);
  });
});

describe('setQuota', () => {
  const cfg: SurveyConfig = {
    version: 't',
    varMeta: { persona: { label: 'פרסונה' } },
    screens: [info('a')],
  };

  it('stores a limit and keeps 0 — a closed cell is not "unlimited"', () => {
    expect(setQuota(cfg, 'persona', 'young_couple', 50).varMeta?.persona.quotas).toEqual({
      young_couple: 50,
    });
    expect(setQuota(cfg, 'persona', 'young_couple', 0).varMeta?.persona.quotas).toEqual({
      young_couple: 0,
    });
  });

  it('clearing the field drops the entry, and the empty map with it', () => {
    let next = setQuota(cfg, 'persona', 'young_couple', 50);
    next = setQuota(next, 'persona', 'upgrader', 30);
    next = setQuota(next, 'persona', 'young_couple', undefined);
    expect(next.varMeta?.persona.quotas).toEqual({ upgrader: 30 });

    next = setQuota(next, 'persona', 'upgrader', undefined);
    expect(next.varMeta?.persona.quotas).toBeUndefined();
    expect(next.varMeta?.persona.label).toBe('פרסונה');
  });

  it('a quota on a mark that has no varMeta yet does not lose its name', () => {
    const bare: SurveyConfig = { version: 't', screens: [info('a')] };
    expect(setQuota(bare, 'persona', 'x', 5).varMeta?.persona).toEqual({
      label: 'persona',
      quotas: { x: 5 },
    });
  });
});

// ── renaming a code before the first publish (ENG-22) ──

describe('renameVar', () => {
  const cfg: SurveyConfig = {
    version: 't',
    randomVars: { price: [99, 199] },
    varMeta: {
      seg: { label: 'מסלול', values: { A: 'מסלול א' }, quotas: { A: 10 } },
      price: { label: 'מחיר' },
    },
    screens: [
      info('a', { title: 'המחיר {price} ומסלול {seg}', onSubmit: [{ var: 'seg', value: 'A' }] }),
      info('b', {
        showIf: { all: [{ var: 'seg', op: 'eq', value: 'A' }, { q: 'a', op: 'answered' }] },
        next: [{ if: { not: { var: 'seg', op: 'eq', value: 'B' } }, goto: 'a' }],
      }),
    ],
  };

  it('repoints onSubmit, conditions at any depth, labels, quotas and interpolation', () => {
    const next = renameVar(cfg, 'seg', 'segment');

    expect(next.screens[0].onSubmit).toEqual([{ var: 'segment', value: 'A' }]);
    expect(next.screens[1].showIf).toEqual({
      all: [{ var: 'segment', op: 'eq', value: 'A' }, { q: 'a', op: 'answered' }],
    });
    expect(next.screens[1].next?.[0].if).toEqual({ not: { var: 'segment', op: 'eq', value: 'B' } });
    expect(next.varMeta?.segment).toEqual(cfg.varMeta!.seg);
    expect(next.varMeta?.seg).toBeUndefined();
    expect((next.screens[0] as { title: string }).title).toBe('המחיר {price} ומסלול {segment}');
  });

  it('renames a draw everywhere it is named, including its value list', () => {
    const next = renameVar(cfg, 'price', 'offer');
    expect(next.randomVars).toEqual({ offer: [99, 199] });
    expect((next.screens[0] as { title: string }).title).toBe('המחיר {offer} ומסלול {seg}');
  });

  it('keeps the key order — the order is what the admin sees', () => {
    expect(Object.keys(renameVar(cfg, 'seg', 'segment').varMeta ?? {})).toEqual([
      'segment',
      'price',
    ]);
  });

  it('leaves everything alone when the code did not change', () => {
    expect(renameVar(cfg, 'seg', 'seg')).toBe(cfg);
  });

  it('does not touch a same-named question or a different variable', () => {
    const next = renameVar(cfg, 'seg', 'segment');
    expect(next.screens[1].showIf).toEqual({
      all: [{ var: 'segment', op: 'eq', value: 'A' }, { q: 'a', op: 'answered' }],
    });
    expect(next.varMeta?.price).toEqual({ label: 'מחיר' });
  });

  it('carries the mark’s quotas across to the new code', () => {
    // Asserted on its own and not as part of the whole-object comparison above:
    // a quota left behind on the old code counts nothing and stops nobody, and
    // there would be no sign of it in the console.
    expect(renameVar(cfg, 'seg', 'segment').varMeta?.segment.quotas).toEqual({ A: 10 });
  });

  it('replaces every occurrence of the name in one text, not only the first', () => {
    const c: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      screens: [info('a', { title: '{price} וגם {price}, ושוב {price}' })],
    };
    expect((renameVar(c, 'price', 'offer').screens[0] as { title: string }).title).toBe(
      '{offer} וגם {offer}, ושוב {offer}',
    );
  });

  it('reaches a reference nested inside a marking rule’s own condition', () => {
    const c: SurveyConfig = {
      version: 't',
      varMeta: { seg: { label: 'מסלול' } },
      screens: [
        info('a', {
          onSubmit: [
            { var: 'other', value: 'x', if: { not: { any: [{ var: 'seg', op: 'eq', value: 'A' }] } } },
          ],
        }),
      ],
    };
    expect(renameVar(c, 'seg', 'segment').screens[0].onSubmit?.[0].if).toEqual({
      not: { any: [{ var: 'segment', op: 'eq', value: 'A' }] },
    });
  });

  it('renaming a code that is both a draw and a named mark moves both maps together', () => {
    const c: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      varMeta: { price: { label: 'מחיר', values: { '99': 'זול' } } },
      screens: [info('a', { title: '{price}' })],
    };
    const next = renameVar(c, 'price', 'offer');
    expect(next.randomVars).toEqual({ offer: [99, 199] });
    expect(next.varMeta?.offer).toEqual({ label: 'מחיר', values: { '99': 'זול' } });
    expect(next.randomVars?.price).toBeUndefined();
    expect(next.varMeta?.price).toBeUndefined();
  });

  it('renaming onto a code that is taken overwrites it — the form is what prevents this', () => {
    // Pinning the documented assumption rather than endorsing it: renameVar does
    // not check, because DefineForm.takenCodes checks first and can explain the
    // problem to the admin. Any future caller that skips the form loses data here
    // with no error at all.
    const clash: SurveyConfig = {
      version: 't',
      varMeta: { price: { label: 'מחיר' }, seg: { label: 'מסלול', quotas: { A: 10 } } },
      screens: [info('a')],
    };
    const next = renameVar(clash, 'seg', 'price');
    expect(next.varMeta?.price).toEqual({ label: 'מסלול', quotas: { A: 10 } });
    expect(Object.keys(next.varMeta ?? {})).toEqual(['price']);
  });
});

describe('renameVarValue', () => {
  const cfg: SurveyConfig = {
    version: 't',
    varMeta: { seg: { label: 'מסלול', values: { A: 'מסלול א', B: 'מסלול ב' }, quotas: { A: 10 } } },
    screens: [
      info('a', {
        onSubmit: [
          { var: 'seg', value: 'A' },
          { var: 'seg', value: 'B' },
        ],
      }),
      info('b', { showIf: { var: 'seg', op: 'in', value: ['A', 'B'] } }),
      info('c', { showIf: { var: 'other', op: 'eq', value: 'A' } }),
    ],
  };

  it('repoints the rule, the label, the quota and list values inside conditions', () => {
    const next = renameVarValue(cfg, 'seg', 'A', 'track_a');

    expect(next.screens[0].onSubmit).toEqual([
      { var: 'seg', value: 'track_a' },
      { var: 'seg', value: 'B' },
    ]);
    expect(next.screens[1].showIf).toEqual({ var: 'seg', op: 'in', value: ['track_a', 'B'] });
    expect(next.varMeta?.seg.values).toEqual({ track_a: 'מסלול א', B: 'מסלול ב' });
    expect(next.varMeta?.seg.quotas).toEqual({ track_a: 10 });
  });

  it('leaves the same value on a different mark untouched', () => {
    expect(renameVarValue(cfg, 'seg', 'A', 'track_a').screens[2].showIf).toEqual({
      var: 'other',
      op: 'eq',
      value: 'A',
    });
  });

  it('matches a value stored as a number, since the form always hands back text', () => {
    const numeric: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      screens: [info('a', { onSubmit: [{ var: 'price', value: 99 }] })],
    };
    const next = renameVarValue(numeric, 'price', '99', '149');
    expect(next.screens[0].onSubmit).toEqual([{ var: 'price', value: '149' }]);
    // In the draw list the value stays a number, because from there it feeds numeric conditions
    expect(next.randomVars?.price).toEqual([149, 199]);
  });

  it('leaves the wording alone — a {name} token names a variable, never one of its values', () => {
    // The token is looked up against the vars and the answers (interpolate in
    // engine/conditions.ts), so a value code is not something it can ever point
    // at. `{A}` below is deliberately spelled like the value being renamed, to
    // show there is nothing here for the rename to find.
    const c: SurveyConfig = {
      version: 't',
      varMeta: { seg: { label: 'מסלול', values: { A: 'מסלול א' } } },
      screens: [info('a', { title: 'הערך הוא {A} ותמיד {seg}', onSubmit: [{ var: 'seg', value: 'A' }] })],
    };
    const next = renameVarValue(c, 'seg', 'A', 'track_a');
    expect((next.screens[0] as { title: string }).title).toBe('הערך הוא {A} ותמיד {seg}');
    expect(next.screens[0].onSubmit).toEqual([{ var: 'seg', value: 'track_a' }]);
  });

  it('does not invent a value on an "answered" leaf that has none', () => {
    const c: SurveyConfig = {
      version: 't',
      screens: [info('a', { showIf: { var: 'seg', op: 'answered' } })],
    };
    expect(renameVarValue(c, 'seg', 'A', 'track_a').screens[0].showIf).toEqual({
      var: 'seg',
      op: 'answered',
    });
  });
});

describe('varReferences', () => {
  const cfg: SurveyConfig = {
    version: 't',
    randomVars: { price: [99, 199] },
    screens: [
      info('a', { title: 'המחיר הוא {price}' }),
      info('b', { showIf: { all: [{ not: { var: 'price', op: 'eq', value: 99 } }] } }),
      info('c', { next: [{ if: { var: 'price', op: 'gt', value: 100 }, goto: 'a' }] }),
      info('d', { title: 'בלי הפניות' }),
    ],
  };

  it('finds conditions at any nesting depth, and {name} in screen text', () => {
    expect(varReferences(cfg, 'price')).toEqual([
      { screenId: 'a', kind: 'text' },
      { screenId: 'b', kind: 'condition' },
      { screenId: 'c', kind: 'condition' },
    ]);
  });

  it('is empty for a variable nothing points at', () => {
    expect(varReferences(cfg, 'ghost')).toEqual([]);
  });
});

// ── deleting a draw that is still in use (ENG-19) ──
//
// varReferences is the warning the admin gets before they click, and
// validateConfig is what the survey looks like afterwards if they click anyway.
// Tested together, because the pair is the actual promise: nobody deletes a
// variable and finds out later.

describe('removing a draw that is still referenced', () => {
  const done: Screen = { id: 'e', type: 'end', variant: 'complete', title: 'סיום', body: '' };

  it('breaks both the condition and the wording, and both were named beforehand', () => {
    const cfg: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      screens: [
        info('a', { title: 'המחיר הוא {price}' }),
        info('b', { showIf: { var: 'price', op: 'gt', value: 100 } }),
        done,
      ],
    };
    expect(varReferences(cfg, 'price')).toEqual([
      { screenId: 'a', kind: 'text' },
      { screenId: 'b', kind: 'condition' },
    ]);

    const issues = validateConfig(removeRandomVar(cfg, 'price'));
    expect(issues.some((i) => i.code === 'unknown-ref' && i.message.includes('price'))).toBe(true);
    expect(issues.some((i) => i.code === 'unknown-interpolation' && i.message.includes('price'))).toBe(
      true,
    );
  });

  it('a draw nothing points at leaves the survey exactly as it was', () => {
    const cfg: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199], ghost: [1, 2] },
      screens: [info('a', { title: 'המחיר הוא {price}' }), done],
    };
    expect(varReferences(cfg, 'ghost')).toEqual([]);
    expect(validateConfig(removeRandomVar(cfg, 'ghost'))).toEqual(validateConfig(cfg));
  });

  it('finds a reference buried in a nested condition, and flags it after the delete', () => {
    const cfg: SurveyConfig = {
      version: 't',
      randomVars: { price: [99, 199] },
      screens: [
        info('a'),
        info('b', {
          showIf: { not: { any: [{ all: [{ var: 'price', op: 'gt', value: 100 }] }] } },
        }),
        done,
      ],
    };
    expect(varReferences(cfg, 'price')).toEqual([{ screenId: 'b', kind: 'condition' }]);
    const issue = validateConfig(removeRandomVar(cfg, 'price')).find((i) => i.code === 'unknown-ref');
    expect(issue?.screenId).toBe('b');
  });
});
