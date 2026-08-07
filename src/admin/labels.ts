// תוויות עברית משותפות לקונסולה.

import type { Op, Screen } from '../engine/types';

export const TYPE_LABELS: Record<Screen['type'], string> = {
  info: 'מסך מידע',
  consent: 'הסכמה',
  single: 'בחירה יחידה',
  multi: 'רב-ברירה',
  matrix: 'מטריצה',
  number: 'מספר',
  text: 'טקסט חופשי',
  end: 'סיום',
};

export const OP_LABELS: Record<Op, string> = {
  eq: 'שווה ל…',
  ne: 'שונה מ…',
  lt: 'קטן מ…',
  lte: 'קטן או שווה ל…',
  gt: 'גדול מ…',
  gte: 'גדול או שווה ל…',
  in: 'אחד מתוך…',
  includes: 'כולל את…',
  includesAny: 'כולל לפחות אחד מ…',
  answered: 'נענתה',
};

/** אופרטורים שערכם רשימה */
export const LIST_OPS: Op[] = ['in', 'includesAny'];

/** תקציר טקסטואלי קצר של מסך לרשימה */
export function screenExcerpt(screen: Screen): string {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return screen.title;
    default:
      return screen.prompt;
  }
}
