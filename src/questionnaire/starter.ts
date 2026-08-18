// The skeleton for a new survey created in the console. Deliberately the minimum
// that passes validateConfig without errors — an opening screen and an end screen
// — so the survey can be published and its link tested before a single question
// has been written. Built on the server (admin-surveys.mts) and never sent from
// the browser.

import type { SurveyConfig } from '../engine/types';

export function starterConfig(name: string): SurveyConfig {
  return {
    version: 'draft',
    screens: [
      {
        id: 'welcome',
        type: 'info',
        title: name.trim() || 'שאלון חדש',
        body: 'תודה שהסכמתם להשתתף. השאלון קצר ואנונימי.',
        cta: 'התחלה',
      },
      {
        id: 'end_complete',
        type: 'end',
        variant: 'complete',
        title: 'תודה רבה!',
        body: 'התשובות שלכם נקלטו. אפשר לסגור את החלון.',
      },
    ],
  };
}
