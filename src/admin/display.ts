// The console's naming layer: every place the admin sees a screen, an answer, a
// variable or a condition goes through here. The ids (s_status, segment,
// end_screenout) remain the analysis codes and do not disappear — they simply
// stop being what people read.
//
// Pure functions only, with no React, so they can be unit-tested.

import type { Condition, Op, Screen, SurveyConfig, VarMeta } from '../engine/types';
import { TYPE_LABELS } from './labels';

/** The minimum context needed to turn an id into a label. Built once from the config. */
export interface Naming {
  screens: Screen[];
  varMeta: Record<string, VarMeta>;
  /** Every session variable name the config assigns or draws */
  vars: string[];
}

export function makeNaming(config: SurveyConfig): Naming {
  const vars = new Set<string>(Object.keys(config.randomVars ?? {}));
  for (const s of config.screens) for (const r of s.onSubmit ?? []) vars.add(r.var);
  for (const name of Object.keys(config.varMeta ?? {})) vars.add(name);
  return { screens: config.screens, varMeta: config.varMeta ?? {}, vars: [...vars] };
}

const MAX_LABEL = 70;

// What happened to a respondent who arrived here, rather than the name of the
// category ("screening") — the difference between the three is everything that
// separates one end screen from another, and it has to read without knowing the
// glossary.
const END_VARIANT_LABELS: Record<'complete' | 'screenout' | 'quotafull', string> = {
  complete: 'ענה על הכול',
  screenout: 'לא מתאים למחקר',
  quotafull: 'המכסה כבר מלאה',
};

const CONSENT_ANSWERS: Record<string, string> = {
  agreed: 'הסכים/ה להשתתף',
  declined: 'סירב/ה להשתתף',
};

function squash(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_LABEL ? `${clean.slice(0, MAX_LABEL - 1)}…` : clean;
}

/**
 * What the admin reads instead of the id. A screen with no text still needs a
 * name — we fall back to the id and not to an empty string, otherwise a new
 * screen becomes a row with nothing to recognise it by.
 */
export function screenLabel(screen: Screen): string {
  const raw =
    screen.type === 'info' || screen.type === 'consent' || screen.type === 'end'
      ? screen.title
      : screen.prompt;
  const text = squash(raw ?? '');
  return text || screen.id;
}

/** The screen type in Hebrew; on an end screen the variant too, because "end" alone does not tell the three apart. */
export function screenKindLabel(screen: Screen): string {
  return screen.type === 'end'
    ? `${TYPE_LABELS.end} · ${END_VARIANT_LABELS[screen.variant]}`
    : TYPE_LABELS[screen.type];
}

/**
 * A reference to another screen (in dropdowns, in conditions, in the context
 * panel). The ordinal is part of the label and not decoration: two screens can
 * carry the same wording, and the label alone would be ambiguous.
 */
export function screenRef(naming: Naming, id: string): string {
  const index = naming.screens.findIndex((s) => s.id === id);
  if (index < 0) return id;
  return `${index + 1} · ${screenLabel(naming.screens[index])}`;
}

/** The label for an answer value: an option id → the option's wording. */
export function answerLabel(naming: Naming, screenId: string, value: unknown): string {
  const screen = naming.screens.find((s) => s.id === screenId);
  const raw = String(value ?? '');
  if (!screen) return raw;
  if (screen.type === 'single' || screen.type === 'multi') {
    const option = screen.options.find((o) => o.id === raw);
    return option ? squash(option.label) || option.id : raw;
  }
  if (screen.type === 'consent') return CONSENT_ANSWERS[raw] ?? raw;
  return raw;
}

export function varLabel(naming: Naming, name: string): string {
  return naming.varMeta[name]?.label || name;
}

export function varValueLabel(naming: Naming, name: string, value: unknown): string {
  const raw = String(value ?? '');
  return naming.varMeta[name]?.values?.[raw] ?? raw;
}

/** A maqaf at the end of the phrase = it attaches to the value ("less than 18"); everything else is separated by a space. */

// The subject of the sentence on a question leaf is always "the answer" — feminine in Hebrew.
const OP_PHRASES_ANSWER: Record<Op, string> = {
  eq: 'היא',
  ne: 'אינה',
  lt: 'קטנה מ־',
  lte: 'קטנה או שווה ל־',
  gt: 'גדולה מ־',
  gte: 'גדולה או שווה ל־',
  in: 'היא אחת מאלה:',
  includes: 'כוללת את',
  includesAny: 'כוללת לפחות אחד מאלה:',
  answered: '', // phrased separately — "there is an answer"
};

// Marks ("the respondent's track") stay in the generic masculine.
const OP_PHRASES_VAR: Record<Op, string> = {
  eq: 'הוא',
  ne: 'אינו',
  lt: 'קטן מ־',
  lte: 'קטן או שווה ל־',
  gt: 'גדול מ־',
  gte: 'גדול או שווה ל־',
  in: 'הוא אחד מאלה:',
  includes: 'כולל את',
  includesAny: 'כולל לפחות אחד מאלה:',
  answered: 'נקבע',
};

type Leaf = { q?: string; var?: string; op: Op; value?: unknown };

/**
 * Who "self" is in the sentence: when the condition points at the screen the
 * editor is standing on, there is no point quoting its own question back at
 * them — we write "the answer here" (or another wording the caller supplies,
 * like "the answer there").
 */
export interface SentenceOpts {
  selfId?: string;
  selfText?: string;
}

/** Values inside a sentence are truncated shorter than headings — two or three of them share a line. */
const MAX_VALUE = 45;

function leafSentence(naming: Naming, leaf: Leaf, opts?: SentenceOpts): string {
  const isQ = leaf.q !== undefined;
  const self = isQ && opts?.selfId !== undefined && leaf.q === opts.selfId;
  // The subject of the sentence: on a question — always "the answer", because the
  // answer is what is being discussed, not the question's wording
  const subject = self
    ? (opts?.selfText ?? 'התשובה כאן')
    : isQ
      ? `התשובה ל״${screenLabel(findScreen(naming, leaf.q!))}״`
      : varLabel(naming, leaf.var!);
  if (leaf.op === 'answered') {
    if (!isQ) return `${subject} נקבע`;
    return self
      ? 'יש תשובה כאן'
      : `יש תשובה ל״${screenLabel(findScreen(naming, leaf.q!))}״`;
  }
  const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  const text = values
    .map((v) => (isQ ? answerLabel(naming, leaf.q!, v) : varValueLabel(naming, leaf.var!, v)))
    .map((t) => (t.length > MAX_VALUE ? `${t.slice(0, MAX_VALUE - 1)}…` : t))
    .join(' / ');
  const phrase = (isQ ? OP_PHRASES_ANSWER : OP_PHRASES_VAR)[leaf.op];
  return `${subject} ${phrase}${phrase.endsWith('־') ? '' : ' '}${text}`.trim();
}

function findScreen(naming: Naming, id: string): Screen {
  return naming.screens.find((s) => s.id === id) ?? ({ id, type: 'info', title: id, body: '' } as Screen);
}

/**
 * The condition as a single Hebrew sentence. The recursive construction wraps
 * nested groups in parentheses — without that, "a and b or c" reads fine and is
 * ambiguous, and that is precisely the mistake that costs dearly.
 */
export function conditionSentence(
  naming: Naming,
  cond: Condition,
  nested = false,
  opts?: SentenceOpts,
): string {
  if ('all' in cond || 'any' in cond) {
    const parts = 'all' in cond ? cond.all : cond.any;
    const joiner = 'all' in cond ? ' וגם ' : ' או ';
    if (parts.length === 0) return nested ? '(תמיד)' : 'תמיד';
    if (parts.length === 1) return conditionSentence(naming, parts[0], nested, opts);
    const body = parts.map((c) => conditionSentence(naming, c, true, opts)).join(joiner);
    return nested ? `(${body})` : body;
  }
  // "it is not true that" rather than a bare "not": the negation reads as a
  // sentence and not as a mathematical sign. Always in parentheses: "not a and b"
  // reads two ways, and nested=false guarantees exactly one pair
  if ('not' in cond) return `לא נכון ש: (${conditionSentence(naming, cond.not, false, opts)})`;
  return leafSentence(naming, cond as Leaf, opts);
}

/** The condition as a sentence, or "always" when there is none — so callers never have to handle undefined. */
export function optionalConditionSentence(
  naming: Naming,
  cond: Condition | undefined,
  opts?: SentenceOpts,
): string {
  return cond ? conditionSentence(naming, cond, false, opts) : 'תמיד';
}

/**
 * The validation messages are written in the engine — shared with the server —
 * and so they quote ids. Rather than duplicating the wording for the console,
 * every recognised id inside quotes is swapped here for its name. Anything
 * unrecognised (an option value, a number) is left alone — a visible id beats a
 * wrong substitution.
 */
export function humanizeMessage(naming: Naming, message: string): string {
  return message.replace(/"([^"]+)"/g, (whole, token: string) => {
    if (naming.screens.some((s) => s.id === token)) return `״${screenRef(naming, token)}״`;
    if (naming.vars.includes(token)) return `״${varLabel(naming, token)}״`;
    return whole;
  });
}

/** The session variables the condition leans on — for working out "what has to happen first". */
export function conditionVars(cond: Condition): string[] {
  if ('all' in cond) return cond.all.flatMap(conditionVars);
  if ('any' in cond) return cond.any.flatMap(conditionVars);
  if ('not' in cond) return conditionVars(cond.not);
  return 'var' in cond ? [cond.var] : [];
}

/** The ids of the questions the condition leans on — the basis for the simulator's answer pickers. */
export function conditionQuestions(cond: Condition): string[] {
  if ('all' in cond) return cond.all.flatMap(conditionQuestions);
  if ('any' in cond) return cond.any.flatMap(conditionQuestions);
  if ('not' in cond) return conditionQuestions(cond.not);
  return 'q' in cond ? [cond.q] : [];
}
