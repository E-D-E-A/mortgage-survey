// שלד לשאלון חדש שנוצר בקונסולה. מכוון להיות המינימום שעובר validateConfig
// בלי שגיאות — מסך פתיחה ומסך סיום — כדי שאפשר יהיה לפרסם ולבדוק את הקישור
// עוד לפני שנכתבה שאלה אחת. נבנה בשרת (admin-surveys.mts) ולא נשלח מהדפדפן.

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
