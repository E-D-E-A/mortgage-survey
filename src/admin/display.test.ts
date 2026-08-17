// The naming layer is what the admin reads on every screen of the console — if it
// silently falls back to ids, the whole interface reverts to s_status and segment
// without a single test failing. So the fallback itself is asserted here
// explicitly.

import { describe, expect, it } from 'vitest';
import type { SurveyConfig } from '../engine/types';
import {
  answerLabel,
  conditionSentence,
  conditionQuestions,
  makeNaming,
  optionalConditionSentence,
  screenKindLabel,
  screenLabel,
  screenRef,
  varLabel,
  varValueLabel,
} from './display';

const config: SurveyConfig = {
  version: 'test',
  randomVars: { price: [99, 199] },
  varMeta: {
    segment: {
      label: 'מסלול המשיב',
      values: { A: 'מסלול A — בעלי משכנתה', B: 'מסלול B — לקראת משכנתה' },
    },
  },
  screens: [
    { id: 's_intro', type: 'info', title: 'ברוכים הבאים', body: '' },
    {
      id: 's_status',
      type: 'single',
      prompt: 'מה מתאר את מצבך בנוגע למשכנתה?',
      options: [
        { id: 'active', label: 'קיימת כיום משכנתה' },
        { id: 'none', label: 'אף אחד מהמצבים' },
      ],
      onSubmit: [{ var: 'segment', value: 'A' }],
    },
    { id: 's_age', type: 'number', prompt: 'מה גילך?' },
    { id: 's_blank', type: 'text', prompt: '' },
    { id: 'end_screenout', type: 'end', variant: 'screenout', title: 'תודה', body: '' },
  ],
};

const naming = makeNaming(config);

describe('screen naming', () => {
  it('reads the title or prompt, not the id', () => {
    expect(screenLabel(config.screens[1])).toBe('מה מתאר את מצבך בנוגע למשכנתה?');
    expect(screenLabel(config.screens[0])).toBe('ברוכים הבאים');
  });

  it('falls back to the id when a screen has no text yet', () => {
    expect(screenLabel(config.screens[3])).toBe('s_blank');
  });

  it('distinguishes the three end variants by what happened to the respondent', () => {
    expect(screenKindLabel(config.screens[4])).toBe('מסך סיום · לא מתאים למחקר');
  });

  it('prefixes references with the position, so identical wording stays distinct', () => {
    expect(screenRef(naming, 's_age')).toBe('3 · מה גילך?');
  });

  it('leaves an unknown id readable instead of blank', () => {
    expect(screenRef(naming, 'gone')).toBe('gone');
  });
});

describe('value naming', () => {
  it('turns an option id into its wording', () => {
    expect(answerLabel(naming, 's_status', 'active')).toBe('קיימת כיום משכנתה');
  });

  it('keeps an unknown option id visible rather than dropping it', () => {
    expect(answerLabel(naming, 's_status', 'typo')).toBe('typo');
  });

  it('names session vars and their values from varMeta', () => {
    expect(varLabel(naming, 'segment')).toBe('מסלול המשיב');
    expect(varValueLabel(naming, 'segment', 'A')).toBe('מסלול A — בעלי משכנתה');
  });

  it('falls back to the raw name for a var with no metadata', () => {
    expect(varLabel(naming, 'price')).toBe('price');
    expect(varValueLabel(naming, 'segment', 'pending')).toBe('pending');
  });

  it('collects randomVars and onSubmit vars alike', () => {
    expect(naming.vars.sort()).toEqual(['price', 'segment']);
  });

  it('lists a draw once, however many places also mention it', () => {
    // The list feeds the condition dropdowns; a name offered twice reads as two
    // different variables that happen to share a label.
    const c: SurveyConfig = {
      version: 'test',
      randomVars: { price: [99, 199] },
      varMeta: { price: { label: 'מחיר' } },
      screens: [
        { id: 'a', type: 'info', title: '', body: '', onSubmit: [{ var: 'price', value: 150 }] },
      ],
    };
    expect(makeNaming(c).vars.filter((v) => v === 'price')).toHaveLength(1);
  });

  it('offers draws before the marks the screens set — the order the dropdown shows', () => {
    const c: SurveyConfig = {
      version: 'test',
      randomVars: { price: [99, 199] },
      screens: [
        { id: 'a', type: 'info', title: '', body: '', onSubmit: [{ var: 'segment', value: 'A' }] },
      ],
    };
    expect(makeNaming(c).vars).toEqual(['price', 'segment']);
  });

  it('shows a draw value by its number when no Hebrew name was given to it', () => {
    const c: SurveyConfig = {
      version: 'test',
      randomVars: { price: [99, 199] },
      varMeta: { price: { label: 'מחיר' } },
      screens: [],
    };
    expect(varValueLabel(makeNaming(c), 'price', 99)).toBe('99');
  });
});

describe('conditionSentence', () => {
  // The subject is always "the answer" — feminine in Hebrew — because the condition examines the answer, not the question
  it('writes a question leaf as the answer to its wording, not ids', () => {
    expect(conditionSentence(naming, { q: 's_status', op: 'eq', value: 'active' })).toBe(
      'התשובה ל״מה מתאר את מצבך בנוגע למשכנתה?״ היא קיימת כיום משכנתה',
    );
  });

  it('says "the answer here" when the condition refers to the screen being edited', () => {
    expect(
      conditionSentence(naming, { q: 's_status', op: 'eq', value: 'active' }, false, {
        selfId: 's_status',
      }),
    ).toBe('התשובה כאן היא קיימת כיום משכנתה');
  });

  it('writes a var leaf through varMeta', () => {
    expect(conditionSentence(naming, { var: 'segment', op: 'eq', value: 'B' })).toBe(
      'מסלול המשיב הוא מסלול B — לקראת משכנתה',
    );
  });

  it('lists every value of a list operator', () => {
    expect(conditionSentence(naming, { q: 's_status', op: 'in', value: ['active', 'none'] })).toBe(
      'התשובה ל״מה מתאר את מצבך בנוגע למשכנתה?״ היא אחת מאלה: קיימת כיום משכנתה / אף אחד מהמצבים',
    );
  });

  it('drops the value for the answered operator', () => {
    expect(conditionSentence(naming, { q: 's_age', op: 'answered' })).toBe('יש תשובה ל״מה גילך?״');
  });

  it('parenthesises a nested group so the joiner stays unambiguous', () => {
    const cond = {
      all: [
        { var: 'segment', op: 'eq' as const, value: 'A' },
        { any: [{ q: 's_age', op: 'lt' as const, value: 18 }, { q: 's_age', op: 'gt' as const, value: 90 }] },
      ],
    };
    expect(conditionSentence(naming, cond)).toBe(
      'מסלול המשיב הוא מסלול A — בעלי משכנתה וגם (התשובה ל״מה גילך?״ קטנה מ־18 או התשובה ל״מה גילך?״ גדולה מ־90)',
    );
  });

  it('does not parenthesise at the top level', () => {
    const cond = { all: [{ q: 's_age', op: 'gte' as const, value: 18 }] };
    expect(conditionSentence(naming, cond)).toBe('התשובה ל״מה גילך?״ גדולה או שווה ל־18');
  });

  it('negates as a readable prefix', () => {
    expect(conditionSentence(naming, { not: { var: 'segment', op: 'eq', value: 'A' } })).toBe(
      'לא נכון ש: (מסלול המשיב הוא מסלול A — בעלי משכנתה)',
    );
  });

  it('says "always" when there is no condition at all', () => {
    expect(optionalConditionSentence(naming, undefined)).toBe('תמיד');
  });
});

describe('conditionQuestions', () => {
  it('finds every question a condition depends on, however deep', () => {
    const cond = {
      all: [
        { q: 's_status', op: 'eq' as const, value: 'active' },
        { not: { any: [{ q: 's_age', op: 'lt' as const, value: 18 }, { var: 'segment', op: 'eq' as const, value: 'A' }] } },
      ],
    };
    expect(conditionQuestions(cond).sort()).toEqual(['s_age', 's_status']);
  });
});
