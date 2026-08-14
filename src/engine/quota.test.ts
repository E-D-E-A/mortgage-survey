import { describe, expect, it } from 'vitest';
import { hitsFullQuota, quotaCells, quotaFullScreen, quotaFullVar, quotaVars } from './quota';
import type { Screen, SurveyConfig, SurveyContext } from './types';

const config: SurveyConfig = {
  version: 't',
  varMeta: {
    persona: { label: 'פרסונה', quotas: { young_couple: 50, upgrader: 0 } },
    segment: { label: 'מקטע' },
  },
  screens: [
    {
      id: 'q1',
      type: 'single',
      prompt: '?',
      options: [{ id: 'x', label: 'x' }],
      onSubmit: [{ var: 'persona', value: 'young_couple' }],
    },
    { id: 'end', type: 'end', variant: 'complete', title: '', body: '' },
    { id: 'full', type: 'end', variant: 'quotafull', title: '', body: '' },
  ],
};

const ctx = (vars: SurveyContext['vars']): SurveyContext => ({ answers: {}, vars });

describe('quotaCells', () => {
  it('lists only the values that carry a limit', () => {
    expect(quotaCells(config)).toEqual([
      { mark: 'persona', value: 'young_couple', limit: 50 },
      { mark: 'persona', value: 'upgrader', limit: 0 },
    ]);
    expect(quotaCells({ version: 't', screens: [] })).toEqual([]);
  });
});

describe('quotaVars', () => {
  it('flags only the cells that are full, and treats a missing count as zero', () => {
    expect(quotaVars(config, { persona: { young_couple: 49 } })).toEqual({
      // 0 היא מכסה סגורה: היא מלאה עוד לפני שסופרים
      quota_full_persona_upgrader: true,
    });
  });

  it('a count at or past the limit closes the cell', () => {
    expect(quotaVars(config, { persona: { young_couple: 50 } })).toHaveProperty(
      quotaFullVar('persona', 'young_couple'),
      true,
    );
    expect(quotaVars(config, { persona: { young_couple: 9000 } })).toHaveProperty(
      quotaFullVar('persona', 'young_couple'),
      true,
    );
  });

  it('counts for a value with no quota are ignored', () => {
    expect(quotaVars({ ...config, varMeta: {} }, { persona: { young_couple: 9000 } })).toEqual({});
  });
});

describe('quotaFullScreen', () => {
  it('finds the quotafull end screen, or null when there is none', () => {
    expect(quotaFullScreen(config)?.id).toBe('full');
    const without = { ...config, screens: config.screens.filter((s) => s.id !== 'full') };
    expect(quotaFullScreen(without)).toBeNull();
  });
});

describe('hitsFullQuota', () => {
  const screen = config.screens[0];

  it('needs both: this screen sets the value, and the respondent holds it', () => {
    expect(hitsFullQuota(screen, ctx({ persona: 'young_couple', quota_full_persona_young_couple: true }))).toBe(true);
    // הסימון שונה — המסך אמנם יכול היה לקבוע אותו, אבל התנאי שלו לא התקיים
    expect(hitsFullQuota(screen, ctx({ persona: 'upgrader', quota_full_persona_young_couple: true }))).toBe(false);
    expect(hitsFullQuota(screen, ctx({ persona: 'young_couple' }))).toBe(false);
  });

  it('a screen with no onSubmit never fires', () => {
    const plain: Screen = { id: 'x', type: 'info', title: '', body: '' };
    expect(hitsFullQuota(plain, ctx({ quota_full_persona_young_couple: true }))).toBe(false);
  });
});
