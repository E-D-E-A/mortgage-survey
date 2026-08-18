// Presentation and validation rules for a screen's inputs, on the respondent side.
// Extracted from components/inputs.tsx so the behaviour is unit-testable without a DOM.

import { shuffle } from './random';
import type { NumberScreen, Option, TextScreen } from './types';

/**
 * The order the options are displayed in.
 *
 * ⚠ Shuffling applies to content options only. An exclusive option ("none of
 * these", "it is all clear to me") is an escape hatch, not a content option — if
 * it lands in the middle of the list it reads as an ordinary option and skews
 * the selection rates. So it is always anchored at the end.
 *
 * With no shuffling the author's order is kept exactly as written, including an
 * exclusive option deliberately placed at the top of the list (for instance
 * "only me" in b_who).
 */
export function orderOptions(options: readonly Option[], shuffleOptions?: boolean): Option[] {
  if (!shuffleOptions) return [...options];
  return [...shuffle(options.filter((o) => !o.exclusive)), ...options.filter((o) => o.exclusive)];
}

type NumberRules = Pick<NumberScreen, 'min' | 'max' | 'integer'>;

/**
 * The error message for a value typed into a number field, or null when it is
 * valid. An empty field is not an error — nothing has been typed yet, and
 * "continue" is blocked anyway.
 */
export function numberFieldError(rules: NumberRules, raw: string): string | null {
  if (raw.trim() === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return 'יש להזין מספר';
  if (rules.integer && !Number.isInteger(num)) return 'יש להזין מספר שלם, בלי נקודה עשרונית';
  const { min, max } = rules;
  if (min !== undefined && max !== undefined && (num < min || num > max)) {
    return `הערך חייב להיות בין ${min} ל-${max}`;
  }
  if (min !== undefined && num < min) return `הערך חייב להיות ${min} או יותר`;
  if (max !== undefined && num > max) return `הערך חייב להיות ${max} או פחות`;
  return null;
}

/** A valid value to submit, or null when the field is empty or invalid. */
export function numberFieldValue(rules: NumberRules, raw: string): number | null {
  if (raw.trim() === '' || numberFieldError(rules, raw) !== null) return null;
  return Number(raw);
}

/** Default length ceiling for free text — it is sent twice (the answer event + the final payload). */
export const TEXT_MAX_LENGTH = 1000;

export function textLimit(screen: Pick<TextScreen, 'maxLength'>): number {
  // An invalid ceiling falls back to the default. maxLength={0} on the field
  // would block all typing and leave "continue" disabled forever — the
  // respondent is stuck. The validator warns about it separately.
  const { maxLength } = screen;
  return Number.isInteger(maxLength) && (maxLength as number) > 0
    ? (maxLength as number)
    : TEXT_MAX_LENGTH;
}
