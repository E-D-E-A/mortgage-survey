// The Hebrew labels shared across the console.
//
// Every label here is read aloud with no accompanying explanation — it sits in a
// dropdown, with no context and no help text. So it is written the way people
// speak ("one choice"), not the way the structure is named in code ("single").

import type { Op, Screen } from '../engine/types';

export const TYPE_LABELS: Record<Screen['type'], string> = {
  info: 'מסך מידע',
  consent: 'מסך הסכמה',
  single: 'שאלה — בחירה אחת',
  multi: 'שאלה — בחירה מרובה',
  matrix: 'מטריצה (סולם דירוג)',
  number: 'שאלה — מספר',
  text: 'שאלה — טקסט חופשי',
  end: 'מסך סיום',
};

// The dropdown completes the sentence above it, which is why it is written
// twice: the subject of a condition on a question is "the answer" (feminine in
// Hebrew), and the subject of a condition on a mark is the mark's name
// (masculine). One neutral map ("equals…") would force the reader to translate
// between the dropdown and the sentence.
export const OP_LABELS_ANSWER: Record<Op, string> = {
  eq: 'היא בדיוק…',
  ne: 'היא כל דבר חוץ מ…',
  lt: 'קטנה מ…',
  lte: 'קטנה או שווה ל…',
  gt: 'גדולה מ…',
  gte: 'גדולה או שווה ל…',
  in: 'היא אחת מאלה…',
  includes: 'כוללת את…',
  includesAny: 'כוללת לפחות אחת מאלה…',
  answered: 'קיימת — ענו על השאלה',
};

export const OP_LABELS_MARK: Record<Op, string> = {
  eq: 'הוא בדיוק…',
  ne: 'הוא כל דבר חוץ מ…',
  lt: 'קטן מ…',
  lte: 'קטן או שווה ל…',
  gt: 'גדול מ…',
  gte: 'גדול או שווה ל…',
  in: 'הוא אחד מאלה…',
  includes: 'כולל את…',
  includesAny: 'כולל לפחות אחד מאלה…',
  answered: 'כבר נקבע',
};

/** Operators whose value is a list */
export const LIST_OPS: Op[] = ['in', 'includesAny'];
