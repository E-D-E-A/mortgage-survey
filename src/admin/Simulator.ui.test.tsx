// @vitest-environment jsdom
//
// The path check, and specifically its quota switches (ENG-21-AC5).
//
// simulatePath is unit-tested with quota flags handed to it directly. What is
// asserted here is the half that only exists in the component: that the admin has
// a control for each capped cell at all, and that ticking one really does change
// the path the panel shows. This is the only way to see the quota route without
// waiting for a real quota to fill.

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Simulator } from './Simulator';
import { makeNaming } from './display';
import type { Answers, SurveyConfig, Vars } from '../engine/types';

const config: SurveyConfig = {
  version: 't',
  varMeta: {
    persona: {
      label: 'פרסונה',
      values: { young_couple: 'זוג צעיר', owner: 'בעל דירה' },
      quotas: { young_couple: 50, owner: 40 },
    },
  },
  screens: [
    { id: 'intro', type: 'info', title: 'פתיחה', body: '' },
    {
      id: 's_status',
      type: 'single',
      prompt: 'מה מצבך?',
      options: [
        { id: 'planning', label: 'מתכנן' },
        { id: 'active', label: 'יש לי משכנתה' },
      ],
      onSubmit: [
        { var: 'persona', value: 'young_couple', if: { q: 's_status', op: 'eq', value: 'planning' } },
        { var: 'persona', value: 'owner', if: { q: 's_status', op: 'eq', value: 'active' } },
      ],
    },
    { id: 'q_more', type: 'text', prompt: 'עוד משהו?' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'תודה רבה', body: '' },
    { id: 'end_quotafull', type: 'end', variant: 'quotafull', title: 'המכסה כבר מלאה', body: '' },
  ],
};

/** The panel is controlled; this is the editor around it. */
function SimulatorHarness({ initialAnswers = {} }: { initialAnswers?: Answers }) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [quotaFull, setQuotaFull] = useState<Vars>({});
  return (
    <Simulator
      config={config}
      naming={makeNaming(config)}
      answers={answers}
      onAnswers={setAnswers}
      quotaFull={quotaFull}
      onQuotaFull={setQuotaFull}
      onSelect={() => {}}
      onClose={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the path check’s quota switches', () => {
  it('offers one switch per capped cell, named the way the admin named it', () => {
    render(<SimulatorHarness />);
    expect(screen.getByRole('checkbox', { name: /פרסונה = זוג צעיר/ })).toBeDefined();
    expect(screen.getByRole('checkbox', { name: /פרסונה = בעל דירה/ })).toBeDefined();
    // Two cells are capped and no more, so there are exactly two switches
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('shows no quota switches at all on a survey that caps nothing', () => {
    const { quotas: _dropped, ...persona } = config.varMeta!.persona;
    const uncapped: SurveyConfig = { ...config, varMeta: { persona } };
    render(
      <Simulator
        config={uncapped}
        naming={makeNaming(uncapped)}
        answers={{}}
        onAnswers={() => {}}
        quotaFull={{}}
        onQuotaFull={() => {}}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('מכסות שכבר התמלאו')).toBeNull();
  });

  it('ticking the switch reroutes the previewed respondent to the quota-full screen', async () => {
    const user = userEvent.setup();
    render(<SimulatorHarness initialAnswers={{ s_status: 'planning' }} />);

    // Open cell: the respondent walks the survey to the end
    expect(screen.getByText(/ויסיים ב״תודה רבה״/)).toBeDefined();

    await user.click(screen.getByRole('checkbox', { name: /פרסונה = זוג צעיר/ }));

    expect(screen.getByText(/ויסיים ב״המכסה כבר מלאה״/)).toBeDefined();
  });

  it('a filled cell the respondent does not fall into leaves their path alone', async () => {
    // The switch that matters is the one for the value this respondent is marked
    // with — closing any other cell must not turn them away.
    const user = userEvent.setup();
    render(<SimulatorHarness initialAnswers={{ s_status: 'planning' }} />);

    await user.click(screen.getByRole('checkbox', { name: /פרסונה = בעל דירה/ }));

    expect(screen.getByText(/ויסיים ב״תודה רבה״/)).toBeDefined();
  });

  it('un-ticking it puts the respondent back on the normal path', async () => {
    const user = userEvent.setup();
    render(<SimulatorHarness initialAnswers={{ s_status: 'planning' }} />);
    const cell = screen.getByRole('checkbox', { name: /פרסונה = זוג צעיר/ });

    await user.click(cell);
    expect(screen.getByText(/ויסיים ב״המכסה כבר מלאה״/)).toBeDefined();

    await user.click(cell);
    expect(screen.getByText(/ויסיים ב״תודה רבה״/)).toBeDefined();
  });

  it('the switch state is what the panel renders, so it survives a re-render', async () => {
    const user = userEvent.setup();
    render(<SimulatorHarness initialAnswers={{ s_status: 'planning' }} />);
    const cell = screen.getByRole('checkbox', { name: /פרסונה = זוג צעיר/ });

    await user.click(cell);
    expect((cell as HTMLInputElement).checked).toBe(true);

    // Answering again re-renders the whole panel; the quota state is held apart
    // from the answers precisely so this does not reset it
    await user.click(screen.getByRole('button', { name: /ניקוי כל התשובות/ }));
    expect(
      (screen.getByRole('checkbox', { name: /פרסונה = זוג צעיר/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
