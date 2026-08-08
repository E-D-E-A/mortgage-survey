// שכבת השמות של הקונסולה: כל מקום שבו האדמין רואה מסך, תשובה, משתנה או תנאי
// עובר דרך כאן. המזהים (s_status, segment, end_screenout) נשארים קוד האנליזה
// ולא נעלמים — הם פשוט מפסיקים להיות מה שקוראים.
//
// פונקציות טהורות בלבד, בלי React, כדי שאפשר יהיה לבדוק אותן ביחידה.

import type { Condition, Op, Screen, SurveyConfig, VarMeta } from '../engine/types';
import { TYPE_LABELS } from './labels';

/** ההקשר המינימלי שצריך כדי לתרגם מזהה לתווית. נבנה פעם אחת מהקונפיג. */
export interface Naming {
  screens: Screen[];
  varMeta: Record<string, VarMeta>;
  /** כל שמות משתני הסשן שהקונפיג מציב או מגריל */
  vars: string[];
}

export function makeNaming(config: SurveyConfig): Naming {
  const vars = new Set<string>(Object.keys(config.randomVars ?? {}));
  for (const s of config.screens) for (const r of s.onSubmit ?? []) vars.add(r.var);
  for (const name of Object.keys(config.varMeta ?? {})) vars.add(name);
  return { screens: config.screens, varMeta: config.varMeta ?? {}, vars: [...vars] };
}

const MAX_LABEL = 70;

const END_VARIANT_LABELS: Record<'complete' | 'screenout' | 'quotafull', string> = {
  complete: 'השלמה',
  screenout: 'סינון',
  quotafull: 'מכסה מלאה',
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
 * מה שהאדמין קורא במקום המזהה. מסך בלי טקסט עדיין חייב שם — נופלים למזהה
 * ולא למחרוזת ריקה, אחרת מסך חדש הופך לשורה בלי שום סימן היכר.
 */
export function screenLabel(screen: Screen): string {
  const raw =
    screen.type === 'info' || screen.type === 'consent' || screen.type === 'end'
      ? screen.title
      : screen.prompt;
  const text = squash(raw ?? '');
  return text || screen.id;
}

/** סוג המסך בעברית; במסך סיום גם הווריאנט, כי "סיום" לבדו לא מבחין בין השלושה. */
export function screenKindLabel(screen: Screen): string {
  return screen.type === 'end'
    ? `${TYPE_LABELS.end} · ${END_VARIANT_LABELS[screen.variant]}`
    : TYPE_LABELS[screen.type];
}

/**
 * הפניה למסך אחר (ברשימות בחירה, בתנאים, בפאנל ההקשר). המספר הסידורי הוא חלק
 * מהתווית ולא קישוט: שני מסכים יכולים לשאת אותו נוסח, והתווית לבדה דו-משמעית.
 */
export function screenRef(naming: Naming, id: string): string {
  const index = naming.screens.findIndex((s) => s.id === id);
  if (index < 0) return id;
  return `${index + 1} · ${screenLabel(naming.screens[index])}`;
}

/** תווית של ערך תשובה: מזהה אפשרות → נוסח האפשרות. */
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

/** מקף מחבר בסוף הביטוי = נצמד לערך ("קטן מ־18"); כל השאר מופרד ברווח. */
const OP_PHRASES: Record<Op, string> = {
  eq: 'הוא',
  ne: 'אינו',
  lt: 'קטן מ־',
  lte: 'קטן או שווה ל־',
  gt: 'גדול מ־',
  gte: 'גדול או שווה ל־',
  in: 'הוא אחד מאלה:',
  includes: 'כולל את',
  includesAny: 'כולל לפחות אחד מאלה:',
  answered: 'נענתה',
};

type Leaf = { q?: string; var?: string; op: Op; value?: unknown };

function leafSentence(naming: Naming, leaf: Leaf): string {
  const isQ = leaf.q !== undefined;
  const subject = isQ ? `״${screenLabel(findScreen(naming, leaf.q!))}״` : varLabel(naming, leaf.var!);
  if (leaf.op === 'answered') return `${subject} — נענתה`;
  const values = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
  const text = values
    .map((v) => (isQ ? answerLabel(naming, leaf.q!, v) : varValueLabel(naming, leaf.var!, v)))
    .join(' / ');
  const phrase = OP_PHRASES[leaf.op];
  return `${subject} ${phrase}${phrase.endsWith('־') ? '' : ' '}${text}`.trim();
}

function findScreen(naming: Naming, id: string): Screen {
  return naming.screens.find((s) => s.id === id) ?? ({ id, type: 'info', title: id, body: '' } as Screen);
}

/**
 * התנאי כמשפט אחד בעברית. הבנייה הרקורסיבית מסגרת קבוצות מקוננות בסוגריים —
 * בלי זה "א וגם ב או ג" קריא אבל דו-משמעי, וזו בדיוק הטעות שעולה ביוקר.
 */
export function conditionSentence(naming: Naming, cond: Condition, nested = false): string {
  if ('all' in cond || 'any' in cond) {
    const parts = 'all' in cond ? cond.all : cond.any;
    const joiner = 'all' in cond ? ' וגם ' : ' או ';
    if (parts.length === 0) return nested ? '(תמיד)' : 'תמיד';
    if (parts.length === 1) return conditionSentence(naming, parts[0], nested);
    const body = parts.map((c) => conditionSentence(naming, c, true)).join(joiner);
    return nested ? `(${body})` : body;
  }
  // תמיד בסוגריים: "לא א וגם ב" נקרא בשתי דרכים, ו-nested=false מבטיח זוג אחד
  if ('not' in cond) return `לא (${conditionSentence(naming, cond.not)})`;
  return leafSentence(naming, cond as Leaf);
}

/** התנאי כמשפט, או "תמיד" כשאין תנאי — כדי שקורא לא יצטרך לטפל ב-undefined. */
export function optionalConditionSentence(naming: Naming, cond: Condition | undefined): string {
  return cond ? conditionSentence(naming, cond) : 'תמיד';
}

/**
 * הודעות הוולידציה נכתבות במנוע — משותף לשרת — ולכן הן מצטטות מזהים. במקום
 * לשכפל את הנוסח לקונסולה, כל מזהה מוכר בתוך מרכאות מוחלף כאן בשם שלו.
 * מה שאינו מוכר (ערך אפשרות, מספר) נשאר כמו שהוא — עדיף מזהה גלוי מהחלפה שגויה.
 */
export function humanizeMessage(naming: Naming, message: string): string {
  return message.replace(/"([^"]+)"/g, (whole, token: string) => {
    if (naming.screens.some((s) => s.id === token)) return `״${screenRef(naming, token)}״`;
    if (naming.vars.includes(token)) return `״${varLabel(naming, token)}״`;
    return whole;
  });
}

/** משתני הסשן שהתנאי נשען עליהם — לחישוב "מה חייב לקרות לפני". */
export function conditionVars(cond: Condition): string[] {
  if ('all' in cond) return cond.all.flatMap(conditionVars);
  if ('any' in cond) return cond.any.flatMap(conditionVars);
  if ('not' in cond) return conditionVars(cond.not);
  return 'var' in cond ? [cond.var] : [];
}

/** מזהי השאלות שהתנאי נשען עליהן — הבסיס לבורר התשובות בסימולטור. */
export function conditionQuestions(cond: Condition): string[] {
  if ('all' in cond) return cond.all.flatMap(conditionQuestions);
  if ('any' in cond) return cond.any.flatMap(conditionQuestions);
  if ('not' in cond) return conditionQuestions(cond.not);
  return 'q' in cond ? [cond.q] : [];
}
