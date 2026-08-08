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
  /** בחירה באפשרות זו מנקה את כל השאר (למשל "אף אחד מאלה") */
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
  /** המסך מדולג כשהתנאי לא מתקיים */
  showIf?: Condition;
  /** ניתוב מפורש אחרי מענה; בלעדיו ממשיכים למסך הבא שעובר showIf */
  next?: GotoRule[];
  /** חישוב משתני סשן (למשל segment) על בסיס התשובה */
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
  /** אם מוגדר — מוצגת עמודת "לא רלוונטי" בתווית זו */
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
  /** ערכים שלמים בלבד (גיל, מספר ילדים) — בלעדיו מתקבל גם 40.5 */
  integer?: boolean;
}

export interface TextScreen extends BaseScreen {
  type: 'text';
  prompt: string;
  help?: string;
  multiline?: boolean;
  optional?: boolean;
  placeholder?: string;
  /** תקרת תווים; ברירת המחדל היא TEXT_MAX_LENGTH ב-engine/input-rules.ts */
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
 * תוויות אנושיות למשתנה סשן — לתצוגה בקונסולת הניהול בלבד. המנוע מתעלם מהן,
 * ולכן שם המשתנה עצמו נשאר קוד האנליזה (ראו docs/codebook.md) גם כשהאדמין
 * רואה רק עברית.
 */
export interface VarMeta {
  label: string;
  /** ערך → תווית; ערך שאינו כאן מוצג כמות שהוא */
  values?: Record<string, string>;
}

export interface SurveyConfig {
  version: string;
  /** משתנים שמוגרלים פעם אחת בתחילת סשן — למשל מחיר לניסוי B39 */
  randomVars?: Record<string, (string | number)[]>;
  varMeta?: Record<string, VarMeta>;
  screens: Screen[];
}
