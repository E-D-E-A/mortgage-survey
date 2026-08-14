// Config schema for the survey engine.
// The questionnaire itself lives in src/questionnaire/ as data conforming to these types,
// so wording changes never touch engine code.

export type MatrixAnswer = Record<string, number | 'na'>;
export type AnswerValue = string | number | string[] | MatrixAnswer | null;
export type Answers = Record<string, AnswerValue>;
export type Vars = Record<string, string | number | boolean>;

export interface SurveyContext {
  answers: Answers;
  vars: Vars;
}

export type Op =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in' // answer is one of value[]
  | 'includes' // multi-choice answer includes value
  | 'includesAny' // multi-choice answer includes at least one of value[]
  | 'answered';

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { q: string; op: Op; value?: unknown }
  | { var: string; op: Op; value?: unknown };

export interface Option {
  id: string;
  label: string;
  /** Picking this option clears all the others (e.g. "none of these") */
  exclusive?: boolean;
}

export interface SetVarRule {
  var: string;
  value: string | number | boolean;
  if?: Condition;
}

export interface GotoRule {
  if?: Condition;
  goto: string;
}

interface BaseScreen {
  id: string;
  /** The screen is skipped when the condition does not hold */
  showIf?: Condition;
  /** Explicit routing after an answer; without it, on to the next screen that passes its showIf */
  next?: GotoRule[];
  /** Computes session vars (segment, say) from the answer */
  onSubmit?: SetVarRule[];
}

export interface InfoScreen extends BaseScreen {
  type: 'info';
  title: string;
  body: string;
  cta?: string;
}

export interface ConsentScreen extends BaseScreen {
  type: 'consent';
  title: string;
  body: string;
  agreeLabel: string;
  declineLabel: string;
}

export interface SingleChoiceScreen extends BaseScreen {
  type: 'single';
  prompt: string;
  help?: string;
  options: Option[];
  shuffleOptions?: boolean;
}

export interface MultiChoiceScreen extends BaseScreen {
  type: 'multi';
  prompt: string;
  help?: string;
  options: Option[];
  maxSelections?: number;
  shuffleOptions?: boolean;
}

export interface MatrixScreen extends BaseScreen {
  type: 'matrix';
  prompt: string;
  items: { id: string; label: string }[];
  scaleMin: number;
  scaleMax: number;
  minLabel: string;
  maxLabel: string;
  /** When set — a "not applicable" column is shown under this label */
  naLabel?: string;
  shuffleItems?: boolean;
}

export interface NumberScreen extends BaseScreen {
  type: 'number';
  prompt: string;
  help?: string;
  min?: number;
  max?: number;
  unit?: string;
  /** Whole numbers only (age, number of children) — without it 40.5 is accepted too */
  integer?: boolean;
}

export interface TextScreen extends BaseScreen {
  type: 'text';
  prompt: string;
  help?: string;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
  /** Character ceiling; the default is TEXT_MAX_LENGTH in engine/input-rules.ts */
  maxLength?: number;
}

export interface EndScreen extends BaseScreen {
  type: 'end';
  variant: 'complete' | 'screenout' | 'quotafull';
  title: string;
  body: string;
}

export type Screen =
  | InfoScreen
  | ConsentScreen
  | SingleChoiceScreen
  | MultiChoiceScreen
  | MatrixScreen
  | NumberScreen
  | TextScreen
  | EndScreen;

/**
 * Human labels for a session var — for display in the admin console only. The
 * engine ignores them, which is what keeps the variable name itself the analysis
 * code (see docs/codebook.md) even when the admin only ever sees Hebrew.
 */
export interface VarMeta {
  label: string;
  /** value → label; a value that is not here is shown as-is */
  values?: Record<string, string>;
  /**
   * value → quota: how many finished respondents are allowed with this value. A
   * value absent from the map is unlimited — which is why "unlimited" is the
   * absence of an entry and not 0 (0 is a real quota: a cell that is closed).
   * The quota sits next to the labels rather than in a separate survey-level map
   * because it is a property of the value — everything known about "young
   * couple" is in one place.
   *
   * ⚠ Definition only. The counting and the routing live in engine/quota.ts and
   * in the quota-get endpoint.
   */
  quotas?: Record<string, number>;
}

export interface SurveyConfig {
  version: string;
  /** Variables drawn once at the start of a session — the B39 price experiment, for instance */
  randomVars?: Record<string, (string | number)[]>;
  varMeta?: Record<string, VarMeta>;
  screens: Screen[];
}
