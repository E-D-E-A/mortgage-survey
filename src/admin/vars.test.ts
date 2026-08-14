import { describe, expect, it } from 'vitest';
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
  it('a new draw starts with two empty slots and a label', () => {
    const next = addRandomVar(base, 'price', 'מחיר לניסוי');
    expect(next.randomVars).toEqual({ price: ['', ''] });
    expect(next.varMeta?.price.label).toBe('מחיר לניסוי');
  });

  it('editing a value carries its label with it', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');
    cfg = setRandomValueAt(cfg, 'price', 0, 149);

    expect(cfg.randomVars?.price).toEqual([149, '']);
    expect(cfg.varMeta?.price.values).toEqual({ '149': 'הזול' });
  });

  it('deleting a value takes its label, and adding one appends an empty slot', () => {
    let cfg = addRandomVar(base, 'price', 'מחיר');
    cfg = setRandomValueAt(cfg, 'price', 0, 99);
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
    cfg = setRandomValueAt(cfg, 'price', 1, 99);
    cfg = setVarValueLabel(cfg, 'price', '99', 'הזול');

    cfg = removeRandomValueAt(cfg, 'price', 1);
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
