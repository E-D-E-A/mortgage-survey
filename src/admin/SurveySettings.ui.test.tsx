// @vitest-environment jsdom
//
// The survey-level editor and the form every analysis code is born in — the
// console half of ENG-19, ENG-20 and ENG-22.
//
// vars.ts is thoroughly unit-tested underneath this; what those tests cannot see
// is whether the editor above them is wired to any of it. Everything here is
// driven through the controls an admin actually uses, and the assertions are made
// against the config the editor produces.
//
// Queries go through roles and accessible names rather than class names, so the
// tests survive restyling. The Hebrew strings they do depend on are collected at
// the top of the file.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurveySettings } from './SurveySettings';
import { DefineForm } from './DefineForm';
import { makeNaming } from './display';
import type { SurveyConfig } from '../engine/types';

// The copy the tests reach for, in one place: a rewording is a one-line fix here
// rather than a sweep through the file.
const LABEL_FIELD = 'שם ההגרלה — כך היא תיראה בקונסולה';
const CODE_FIELD = 'קוד לקובץ הנתונים';
const CREATE = 'יצירה';
const SAVE_NAME = 'שמירת השם';
const NEW_DRAW = /יצירת הגרלה/;
const ADD_VALUE = /הוספת ערך/;
const DRAW_VALUE = 'הערך שמוגרל';
const RENAME_DRAW = 'שינוי השם שמוצג להגרלה';
const DELETE_DRAW = 'מחיקת ההגרלה';
const TOO_FEW_VALUES = /צריך לפחות שני ערכים/;
const LOCKED_TOOLTIP = 'הקוד קבוע — שינוי שלו היה מנתק אותו מהנתונים שכבר נאספו';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * SurveySettings is controlled — it hands edits up as a function. This wrapper is
 * the parent the console provides, so a click really does run the vars.ts edit
 * and really does re-render from the result. `latest` is how a test reads the
 * config the editor produced.
 */
function EditorHarness({
  initial,
  codesLocked = false,
  onConfig,
}: {
  initial: SurveyConfig;
  codesLocked?: boolean;
  onConfig?: (cfg: SurveyConfig) => void;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <SurveySettings
      config={config}
      naming={makeNaming(config)}
      codesLocked={codesLocked}
      onUpdate={(fn) =>
        setConfig((current) => {
          const next = fn(current);
          onConfig?.(next);
          return next;
        })
      }
      onClose={() => {}}
    />
  );
}

/** A survey with one mark that a screen really sets — enough for the quota section. */
const withMark: SurveyConfig = {
  version: 't',
  varMeta: {
    persona: { label: 'פרסונה', values: { young_couple: 'זוג צעיר', owner: 'בעל דירה' } },
  },
  screens: [
    {
      id: 'q1',
      type: 'single',
      prompt: 'מה מצבך?',
      options: [{ id: 'a', label: 'א' }],
      onSubmit: [{ var: 'persona', value: 'young_couple' }],
    },
    { id: 'end', type: 'end', variant: 'complete', title: 'תודה', body: '' },
  ],
};

const bare: SurveyConfig = {
  version: 't',
  screens: [{ id: 'end', type: 'end', variant: 'complete', title: 'תודה', body: '' }],
};

// ── the form every code is born in (ENG-19-AC3, AC12 · ENG-22-AC2, AC7) ──

describe('DefineForm', () => {
  const renderForm = (props: Partial<Parameters<typeof DefineForm>[0]> = {}) =>
    render(
      <DefineForm
        kind="randomVar"
        renaming={false}
        suggestedCode="rand1"
        suggestedLabel=""
        takenCodes={['price']}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />,
    );

  it('asks for the Hebrew name first and arrives with the code already filled in', () => {
    renderForm();
    expect(screen.getByLabelText(LABEL_FIELD)).toHaveProperty('value', '');
    expect(screen.getByLabelText(CODE_FIELD)).toHaveProperty('value', 'rand1');
  });

  it('will not create anything until the name has been written', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByRole('button', { name: CREATE })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText(LABEL_FIELD), 'מחיר לניסוי');
    expect(screen.getByRole('button', { name: CREATE })).toHaveProperty('disabled', false);
  });

  it('refuses a code that is not a plain English analysis code', async () => {
    // The rule the data file depends on. Checked through the form because that is
    // the only place it is enforced.
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(LABEL_FIELD), 'מחיר');

    for (const bad of ['1price', 'price-1', 'מחיר']) {
      const code = screen.getByLabelText(CODE_FIELD);
      await user.clear(code);
      await user.type(code, bad);
      expect(code.getAttribute('aria-invalid'), `"${bad}" should be rejected`).toBe('true');
      expect(screen.getByRole('button', { name: CREATE })).toHaveProperty('disabled', true);
    }

    const code = screen.getByLabelText(CODE_FIELD);
    await user.clear(code);
    await user.type(code, 'price_2');
    expect(code.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('button', { name: CREATE })).toHaveProperty('disabled', false);
  });

  it('refuses a code another variable already holds', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(LABEL_FIELD), 'מחיר');
    await user.clear(screen.getByLabelText(CODE_FIELD));
    await user.type(screen.getByLabelText(CODE_FIELD), 'price');

    expect(screen.getByRole('button', { name: CREATE })).toHaveProperty('disabled', true);
    expect(screen.getByText(/כבר תפוס בשאלון/)).toBeDefined();
  });

  it('locks the code when renaming on a survey that has been published', () => {
    renderForm({ renaming: true, codeLocked: true, suggestedLabel: 'מחיר' });
    const code = screen.getByLabelText(CODE_FIELD);
    expect(code).toHaveProperty('disabled', true);
    expect(code.getAttribute('title')).toBe(LOCKED_TOOLTIP);
  });

  it('leaves the code open when renaming before the first publish', () => {
    renderForm({ renaming: true, codeLocked: false, suggestedLabel: 'מחיר' });
    expect(screen.getByLabelText(CODE_FIELD)).toHaveProperty('disabled', false);
    expect(screen.getByText(/אחרי הפרסום הראשון הקוד יינעל/)).toBeDefined();
  });

  it('a code written for the first time is editable even on a published survey', () => {
    // The lock is about renaming. A code with nothing behind it yet has no
    // collected data to be cut off from.
    renderForm({ renaming: false, codeLocked: true });
    expect(screen.getByLabelText(CODE_FIELD)).toHaveProperty('disabled', false);
  });
});

// ── the draws editor (ENG-19-AC1) ──

describe('the draws section', () => {
  it('says plainly when a survey has no draws at all', () => {
    render(<EditorHarness initial={bare} />);
    expect(screen.getByText(/אין בשאלון אף הגרלה/)).toBeDefined();
  });

  it('creates a draw, and warns that one value is not an experiment', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    render(<EditorHarness initial={bare} onConfig={(c) => (latest = c)} />);

    await user.click(screen.getByRole('button', { name: NEW_DRAW }));
    await user.type(screen.getByLabelText(LABEL_FIELD), 'מחיר לניסוי');
    await user.click(screen.getByRole('button', { name: CREATE }));

    expect(latest?.randomVars).toEqual({ rand1: [''] });
    expect(latest?.varMeta?.rand1.label).toBe('מחיר לניסוי');
    // Born with one empty slot, so the warning is on screen from the first moment
    expect(screen.getByText(TOO_FEW_VALUES)).toBeDefined();
  });

  it('stops warning once a second value is there', async () => {
    const user = userEvent.setup();
    const oneValue: SurveyConfig = { ...bare, randomVars: { price: [79] }, varMeta: { price: { label: 'מחיר' } } };
    render(<EditorHarness initial={oneValue} />);
    expect(screen.getByText(TOO_FEW_VALUES)).toBeDefined();

    await user.click(screen.getByRole('button', { name: ADD_VALUE }));
    expect(screen.queryByText(TOO_FEW_VALUES)).toBeNull();
  });

  it('edits a value and keeps it a number, so numeric conditions still compare', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    const two: SurveyConfig = { ...bare, randomVars: { price: [79, 149] }, varMeta: { price: { label: 'מחיר' } } };
    render(<EditorHarness initial={two} onConfig={(c) => (latest = c)} />);

    const [first] = screen.getAllByLabelText(DRAW_VALUE);
    await user.clear(first);
    await user.type(first, '99');
    await user.tab(); // the blur is what re-parses the text back into a number

    expect(latest?.randomVars?.price[0]).toBe(99);
  });

  it('renames a draw and repoints the wording that uses it', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    const used: SurveyConfig = {
      version: 't',
      randomVars: { price: [79, 149] },
      varMeta: { price: { label: 'מחיר' } },
      screens: [
        { id: 'intro', type: 'info', title: 'המחיר הוא {price}', body: '' },
        { id: 'end', type: 'end', variant: 'complete', title: 'תודה', body: '' },
      ],
    };
    render(<EditorHarness initial={used} onConfig={(c) => (latest = c)} />);

    await user.click(screen.getByRole('button', { name: RENAME_DRAW }));
    const code = screen.getByLabelText(CODE_FIELD);
    await user.clear(code);
    await user.type(code, 'offer');
    await user.click(screen.getByRole('button', { name: SAVE_NAME }));

    expect(latest?.randomVars).toEqual({ offer: [79, 149] });
    expect((latest?.screens[0] as { title: string }).title).toBe('המחיר הוא {offer}');
  });

  it('warns which screens a deletion would break, and names them', async () => {
    // Validation would report the wreckage afterwards. The admin needs to know
    // before they click, which is the only reason this confirmation exists.
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const used: SurveyConfig = {
      version: 't',
      randomVars: { price: [79, 149] },
      varMeta: { price: { label: 'מחיר' } },
      screens: [
        { id: 'intro', type: 'info', title: 'המחיר הוא {price}', body: '' },
        { id: 'end', type: 'end', variant: 'complete', title: 'תודה', body: '' },
      ],
    };
    let latest: SurveyConfig | undefined;
    render(<EditorHarness initial={used} onConfig={(c) => (latest = c)} />);

    await user.click(screen.getByRole('button', { name: DELETE_DRAW }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain('המחיר הוא {price}');
    // Declining leaves the draw exactly where it was
    expect(latest).toBeUndefined();
    expect(screen.getByText('מחיר')).toBeDefined();
  });

  it('deletes the draw when the warning is accepted', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let latest: SurveyConfig | undefined;
    const two: SurveyConfig = { ...bare, randomVars: { price: [79, 149] }, varMeta: { price: { label: 'מחיר' } } };
    render(<EditorHarness initial={two} onConfig={(c) => (latest = c)} />);

    await user.click(screen.getByRole('button', { name: DELETE_DRAW }));

    expect(latest?.randomVars).toBeUndefined();
    expect(screen.getByText(/אין בשאלון אף הגרלה/)).toBeDefined();
  });
});

// ── the quota fields (ENG-20-AC2, AC9) ──

describe('the quotas section', () => {
  const quotaField = (label: string) => screen.getByLabelText(`מכסה ל״${label}״`);

  it('offers a ceiling beside every value of every mark, empty by default', () => {
    render(<EditorHarness initial={withMark} />);
    expect(quotaField('זוג צעיר')).toHaveProperty('value', '');
    expect(quotaField('בעל דירה')).toHaveProperty('value', '');
    // "Unlimited" has to read as unlimited, not as a zero
    expect(quotaField('זוג צעיר').getAttribute('placeholder')).toBe('בלי הגבלה');
  });

  it('stores the ceiling that was typed', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    render(<EditorHarness initial={withMark} onConfig={(c) => (latest = c)} />);

    await user.type(quotaField('זוג צעיר'), '50');

    expect(latest?.varMeta?.persona.quotas).toEqual({ young_couple: 50 });
  });

  it('keeps 0 — a closed cell is a real quota, not an empty field', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    render(<EditorHarness initial={withMark} onConfig={(c) => (latest = c)} />);

    await user.type(quotaField('זוג צעיר'), '0');

    expect(latest?.varMeta?.persona.quotas).toEqual({ young_couple: 0 });
    expect(quotaField('זוג צעיר')).toHaveProperty('value', '0');
  });

  it('clearing the field removes the ceiling rather than setting it to nothing', async () => {
    const user = userEvent.setup();
    let latest: SurveyConfig | undefined;
    const capped: SurveyConfig = {
      ...withMark,
      varMeta: { persona: { ...withMark.varMeta!.persona, quotas: { young_couple: 50 } } },
    };
    render(<EditorHarness initial={capped} onConfig={(c) => (latest = c)} />);
    expect(quotaField('זוג צעיר')).toHaveProperty('value', '50');

    await user.clear(quotaField('זוג צעיר'));

    expect(latest?.varMeta?.persona.quotas).toBeUndefined();
  });

  it('says so when there is no mark to put a quota on', () => {
    render(<EditorHarness initial={bare} />);
    expect(screen.getByText(/אין בשאלון סימונים/)).toBeDefined();
  });

  it('keeps the Hebrew name and the analysis code visible side by side', () => {
    // Everything the admin reads is Hebrew; everything the data file records is
    // the code. Both have to be on screen for the two to stay connected.
    render(<EditorHarness initial={withMark} />);
    const row = quotaField('זוג צעיר').closest('.quota-row') as HTMLElement;
    expect(within(row).getByText('זוג צעיר')).toBeDefined();
    expect(within(row).getByText('young_couple')).toBeDefined();
    expect(within(row).getByText('young_couple').getAttribute('dir')).toBe('ltr');
  });
});
