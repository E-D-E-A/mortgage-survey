// @vitest-environment jsdom
//
// מה שהאדמין קורא בקונסולה חייב להיות מה שהמשיב קורא במסך. הבדיקה מרנדרת
// **כל מסך בשאלון** כמו שהמשיב רואה אותו, ומשווה לטקסטים שהקונסולה מציגה:
// טקסט הצומת בתרשים (nodeText), שם המסך ברשימות (screenLabel), ושם התשובה
// בתנאים ובבורר של הסימולטור (answerLabel).
//
// זו החוליה השנייה של דרישה 2: לא רק "הקשתות נכונות" אלא "הכתוב על הקשת הוא
// באמת מה שהמשיב יראה". אדמין שמאשר תרשים שמצטט נוסח אחר — מאשר שאלון אחר.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Screen, SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';
import { answerLabel, makeNaming, screenLabel } from './display';
import { nodeText } from './graph';

let App: typeof import('../App').default;
const naming = makeNaming(questionnaire);

beforeAll(async () => {
  window.scrollTo = vi.fn();
  // במצב פיתוח כל אירוע נכתב לקונסול; כאן זה רק רעש שמסתיר כשלים
  vi.spyOn(console, 'info').mockImplementation(() => {});
  ({ default: App } = await import('../App'));
});

afterEach(cleanup);

/** מסך בודד, כמסך הראשון של שאלון מינימלי — showIf אינו נבדק למסך הראשון. */
function renderScreen(s: Screen) {
  const config: SurveyConfig = {
    version: questionnaire.version,
    varMeta: questionnaire.varMeta,
    screens:
      s.type === 'end'
        ? [s]
        : [s, { id: '__end', type: 'end', variant: 'complete', title: 'סוף', body: '' }],
  };
  render(<App config={config} />);
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * הקונסולה מקצרת תוויות ארוכות (70 תווים + …), ולכן ההשוואה היא "אותו נוסח
 * מההתחלה" ולא שוויון מוחלט. מה שנבדק הוא שהיא לא מציגה נוסח *אחר*.
 */
function expectSameWording(consoleText: string, onScreen: string, hint: string) {
  const full = squash(onScreen);
  const shown = consoleText.replace(/…$/, '');
  expect(shown.length, `${hint}: console shows nothing`).toBeGreaterThan(0);
  expect(full.startsWith(shown), `${hint}: console says "${consoleText}", screen says "${full}"`).toBe(
    true,
  );
}

describe.each(questionnaire.screens.map((s) => [s.id, s] as const))(
  'screen %s reads the same in the console and on the phone',
  (_id, s) => {
    it('the diagram node shows the text the respondent sees', () => {
      renderScreen(s);
      const heading = screen.getByRole('heading').textContent ?? '';
      expect(heading).toBe(nodeText(s));
      // screenLabel מקצר ל-70 תווים; מה שנשאר חייב להיות תחילת אותו נוסח
      expectSameWording(screenLabel(s), heading, `screen ${s.id} name`);
    });

    it('every answer the console can name exists on the screen, with that wording', () => {
      renderScreen(s);
      if (s.type === 'single' || s.type === 'multi') {
        const role = s.type === 'single' ? 'radio' : 'checkbox';
        for (const option of s.options) {
          // הופעה על המסך: קורא מסך מקריא את התווית הזאת
          expect(
            screen.getByRole(role, { name: option.label }),
            `option "${option.id}" is missing from screen ${s.id}`,
          ).toBeDefined();
          // ואותה תווית היא מה שהקונסולה תכתוב על הקשת/בתנאי
          expectSameWording(answerLabel(naming, s.id, option.id), option.label, `${s.id}/${option.id}`);
        }
        expect(screen.getAllByRole(role)).toHaveLength(s.options.length);
      } else if (s.type === 'consent') {
        expect(screen.getByRole('button', { name: s.agreeLabel })).toBeDefined();
        expect(screen.getByRole('button', { name: s.declineLabel })).toBeDefined();
        // הקונסולה מתרגמת agreed/declined לתיאור מה שהמשיב עשה
        expect(answerLabel(naming, s.id, 'agreed')).toBe('הסכים/ה להשתתף');
        expect(answerLabel(naming, s.id, 'declined')).toBe('סירב/ה להשתתף');
      } else if (s.type === 'matrix') {
        for (const item of s.items) {
          expect(
            document.querySelector(`[aria-labelledby="${s.id}-${item.id}"]`),
            `matrix row "${item.id}" is missing from screen ${s.id}`,
          ).not.toBeNull();
          expect(screen.getByText(item.label)).toBeDefined();
        }
        // קצות הסולם נושאים את המשמעות, גם לקורא מסך
        expect(screen.getAllByRole('radio', { name: `${s.scaleMin} — ${s.minLabel}` }).length).toBe(
          s.items.length,
        );
        expect(screen.getAllByRole('radio', { name: `${s.scaleMax} — ${s.maxLabel}` }).length).toBe(
          s.items.length,
        );
      }
    });
  },
);

describe('the console never invents wording of its own', () => {
  it('names every screen without falling back to the analysis code', () => {
    for (const s of questionnaire.screens) {
      expect(screenLabel(s), `screen ${s.id} has no readable name`).not.toBe(s.id);
    }
  });

  it('names every option without falling back to its code', () => {
    for (const s of questionnaire.screens) {
      if (s.type !== 'single' && s.type !== 'multi') continue;
      for (const option of s.options) {
        expect(answerLabel(naming, s.id, option.id), `${s.id}/${option.id}`).not.toBe(option.id);
      }
    }
  });

  it('knows every session mark the questionnaire sets', () => {
    for (const s of questionnaire.screens) {
      for (const rule of s.onSubmit ?? []) {
        expect(naming.vars).toContain(rule.var);
        expect(naming.varMeta[rule.var]?.values?.[String(rule.value)]).toBeTruthy();
      }
    }
  });
});
