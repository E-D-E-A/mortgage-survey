import type { AnswerValue, Condition, Screen, SurveyContext } from './types';

/** מעריך תנאי הצגה/ניתוב מול התשובות ומשתני הסשן. */
export function evaluate(cond: Condition, ctx: SurveyContext): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluate(c, ctx));
  if ('any' in cond) return cond.any.some((c) => evaluate(c, ctx));
  if ('not' in cond) return !evaluate(cond.not, ctx);

  const val: AnswerValue | Vars[string] | undefined =
    'q' in cond ? ctx.answers[cond.q] : ctx.vars[cond.var];

  switch (cond.op) {
    case 'answered':
      return (
        val !== null &&
        val !== undefined &&
        val !== '' &&
        !(Array.isArray(val) && val.length === 0)
      );
    case 'eq':
      return val === cond.value;
    case 'ne':
      return val !== cond.value;
    case 'lt':
      return typeof val === 'number' && val < (cond.value as number);
    case 'lte':
      return typeof val === 'number' && val <= (cond.value as number);
    case 'gt':
      return typeof val === 'number' && val > (cond.value as number);
    case 'gte':
      return typeof val === 'number' && val >= (cond.value as number);
    case 'in':
      return Array.isArray(cond.value) && (cond.value as unknown[]).includes(val);
    case 'includes':
      return Array.isArray(val) && (val as unknown[]).includes(cond.value);
    case 'includesAny':
      return (
        Array.isArray(val) &&
        Array.isArray(cond.value) &&
        (cond.value as unknown[]).some((v) => (val as unknown[]).includes(v))
      );
  }
}

type Vars = SurveyContext['vars'];

/** תבנית השיבוץ — נקודת ההגדרה היחידה של התחביר, לקריאה ולכתיבה כאחד. */
const INTERPOLATION_RE = /\{(\w+)\}/g;

/** מחליף ‎{name}‎ בערך ממשתני הסשן או מהתשובות — למשל מחיר מוגרל בתוך נוסח שאלה. */
export function interpolate(text: string, ctx: SurveyContext): string {
  return text.replace(INTERPOLATION_RE, (match, key: string) => {
    const v = ctx.vars[key] ?? ctx.answers[key];
    if (v === null || v === undefined) return match;
    return String(v);
  });
}

/**
 * The names a text interpolates — the read side of interpolate(), for the
 * validator: a `{name}` with nothing behind it is not silently dropped, it is
 * printed to the respondent braces and all.
 */
export function interpolationRefs(text: string): string[] {
  return [...text.matchAll(INTERPOLATION_RE)].map((m) => m[1]);
}

/**
 * The screen fields interpolation actually reaches. Lives next to interpolate()
 * so the validator and the runtime cannot drift on which text a `{name}` works
 * in — ⚠ it must stay in step with withInterpolation() in src/App.tsx.
 */
export function interpolatedTexts(screen: Screen): string[] {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return [screen.title, screen.body];
    default:
      return [screen.prompt];
  }
}
