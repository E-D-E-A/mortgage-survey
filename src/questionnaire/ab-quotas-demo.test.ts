// The demo is only worth having if it actually works, so these tests assert the
// two things a reader would otherwise have to take on trust: that it publishes
// clean, and that the A/B and the quota really behave as the file claims.

import { describe, expect, it } from 'vitest';
import { abQuotasDemo } from './ab-quotas-demo';
import { interpolate } from '../engine/conditions';
import { simulatePath } from '../engine/path';
import { quotaCells, quotaFullVar, quotaVars } from '../engine/quota';
import { validateConfig } from '../engine/validate';
import { buildFlow } from '../admin/graph';
import type { Answers, Vars } from '../engine/types';

const passing: Answers = { consent: 'agreed', s_age: 34 };
const walk = (answers: Answers, seed: Vars = {}) =>
  simulatePath(abQuotasDemo, answers, seed).map((s) => s.screen.id);

describe('the A/B + quotas demo', () => {
  it('publishes clean — no errors and no warnings', () => {
    expect(validateConfig(abQuotasDemo)).toEqual([]);
  });

  it('assigns a persona on s_status, and reassigns it when the answer changes', () => {
    const personaAfter = (status: string) => {
      const steps = simulatePath(abQuotasDemo, { ...passing, s_status: status });
      return steps.find((s) => s.screen.id === 's_status')?.vars.persona;
    };
    expect(personaAfter('planning')).toBe('young_couple');
    expect(personaAfter('active')).toBe('owner');
    // The unconditional default catches everything else, which is what keeps a
    // respondent from carrying a stale persona back with them
    expect(personaAfter('browsing')).toBe('browsing');
  });

  it('routes to the quota-full screen the moment that persona is capped', () => {
    const answers = { ...passing, s_status: 'planning' };
    expect(walk(answers)).toContain('c_timeline');

    const full = quotaVars(abQuotasDemo, { persona: { young_couple: 50 } });
    expect(walk(answers, full)).toEqual(['intro', 'consent', 's_age', 's_status', 'end_quotafull']);
  });

  it('leaves an uncapped persona alone even when the other cells are full', () => {
    const full = quotaVars(abQuotasDemo, { persona: { young_couple: 50, owner: 40 } });
    const path = walk({ ...passing, s_status: 'browsing' }, full);
    expect(path).not.toContain('end_quotafull');
    expect(path[path.length - 1]).toBe('end_complete');
  });

  it('caps exactly the two cells it means to', () => {
    expect(quotaCells(abQuotasDemo)).toEqual([
      { mark: 'persona', value: 'young_couple', limit: 50 },
      { mark: 'persona', value: 'owner', limit: 40 },
    ]);
    expect(quotaVars(abQuotasDemo, { persona: { browsing: 9000 } })).toEqual({});
  });

  it('puts every drawn price into the question the respondent reads', () => {
    const prompt = abQuotasDemo.screens.find((s) => s.id === 'ab_price')!;
    for (const price of abQuotasDemo.randomVars!.price) {
      const shown = interpolate((prompt as { prompt: string }).prompt, {
        answers: {},
        vars: { price },
      });
      expect(shown).toContain(String(price));
      expect(shown).not.toContain('{price}');
    }
  });

  it('shows one framing per arm of the pitch draw, never both', () => {
    const answers = { ...passing, s_status: 'browsing' };
    for (const [pitch, shown, hidden] of [
      ['saving', 'pitch_saving', 'pitch_speed'],
      ['speed', 'pitch_speed', 'pitch_saving'],
    ] as const) {
      const path = walk(answers, { pitch });
      expect(path).toContain(shown);
      expect(path).not.toContain(hidden);
    }
  });

  it('screens out a decline and an under-18 without walking the survey', () => {
    expect(walk({ consent: 'declined' })).toEqual(['intro', 'consent', 'end_screenout']);
    expect(walk({ consent: 'agreed', s_age: 16 })).toEqual([
      'intro',
      'consent',
      's_age',
      'end_screenout',
    ]);
  });

  it('draws the quota route in the diagram, so the screen is not an orphan', () => {
    // Without this edge the quota-full screen hangs in the console's map with
    // nothing pointing at it, and the natural fix — dragging a connection to it
    // by hand — sends every respondent there from the first one onwards.
    const quotaEdges = buildFlow(abQuotasDemo).edges.filter((e) => e.kind === 'quota');
    expect(quotaEdges.map((e) => `${e.from}→${e.to}`)).toEqual(['s_status→end_quotafull']);
    expect(quotaEdges[0].label).toContain('זוג צעיר');
  });

  it('draws no quota route on a survey that has no quotas', () => {
    const { quotas: _dropped, ...persona } = abQuotasDemo.varMeta!.persona;
    const uncapped = { ...abQuotasDemo, varMeta: { ...abQuotasDemo.varMeta, persona } };
    expect(buildFlow(uncapped).edges.some((e) => e.kind === 'quota')).toBe(false);
  });

  it('names every quota flag it can raise', () => {
    // A flag whose name nobody can predict is a flag nobody can debug
    expect(quotaCells(abQuotasDemo).map((c) => quotaFullVar(c.mark, c.value))).toEqual([
      'quota_full:persona:young_couple',
      'quota_full:persona:owner',
    ]);
  });
});
