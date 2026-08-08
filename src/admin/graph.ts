// גזירת גרף הזרימה מהקונפיג — נאמן בדיוק לסמנטיקת המנוע (findNext):
// קודם כללי next מפורשים, ואם אין כלל ללא-תנאי — נפילה קדימה למסך הבא
// שעובר את showIf שלו. תוויות הקשתות הן התשובה שמובילה למסך הבא,
// עם תרגום מזהי אפשרויות לנוסח שהמשיב רואה.

import type { Condition, Screen, SurveyConfig, VarMeta } from '../engine/types';

type VarMetaMap = Record<string, VarMeta>;

const varName = (meta: VarMetaMap, name: string) => meta[name]?.label || name;
const varValue = (meta: VarMetaMap, name: string, value: unknown) =>
  meta[name]?.values?.[String(value)] ?? String(value);

export interface FlowNode {
  id: string;
  screen: Screen;
  /** הטקסט שמוצג בצומת — השאלה עצמה */
  text: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** התשובה/התנאי שמוביל לצומת היעד */
  label: string;
  /** קשת ברירת מחדל (המשך רגיל) לעומת קשת מותנית */
  conditional: boolean;
  /**
   * goto = ניתוב מפורש, primary = המשך למסך הבא,
   * skip = נחיתה רחוקה יותר אחרי דילוג על מסכים מותנים (מוצג מעומעם)
   */
  kind: 'goto' | 'primary' | 'skip';
  /** לקשתות goto: האינדקס של הכלל ב-next של מסך המקור — לעריכת התנאי מהקשת */
  ruleIndex?: number;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** הנוסח שהמשיב רואה עבור ערך תשובה — למשל 'yes' → 'כן' */
function valueLabel(screen: Screen | undefined, value: unknown): string {
  const raw = String(value);
  if (!screen) return raw;
  if (screen.type === 'single' || screen.type === 'multi') {
    return screen.options.find((o) => o.id === raw)?.label || raw;
  }
  if (screen.type === 'consent') {
    if (raw === 'agreed') return screen.agreeLabel;
    if (raw === 'declined') return screen.declineLabel;
  }
  if (screen.type === 'matrix') {
    return screen.items.find((i) => i.id === raw)?.label || raw;
  }
  return raw;
}

function values(screen: Screen | undefined, value: unknown): string {
  return Array.isArray(value)
    ? value.map((v) => valueLabel(screen, v)).join(' / ')
    : valueLabel(screen, value);
}

const NUMERIC_OPS: Record<string, string> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
};

/**
 * "כל התשובות חוץ מ-X" — עדיף למנות את הנותרות ("לא / לא יודע/ת")
 * מאשר לכתוב שלילה ("לא כן"), שקשה לקריאה.
 */
function complement(screen: Screen | undefined, value: unknown): string | null {
  if (!screen || (screen.type !== 'single' && screen.type !== 'multi')) return null;
  const excluded = new Set((Array.isArray(value) ? value : [value]).map(String));
  const rest = screen.options.filter((o) => !excluded.has(o.id));
  if (rest.length === 0 || rest.length > 3) return null;
  return rest.map((o) => o.label).join(' / ');
}

/**
 * תיאור תנאי בעברית קריאה, לתווית על הקשת. משתני סשן עוברים דרך varMeta —
 * "segment: A" על קשת בתרשים הוא בדיוק סוג הדבר שאדמין לא-טכני לא מפענח.
 */
export function describeCondition(cond: Condition, screens: Screen[], meta: VarMetaMap = {}): string {
  if ('all' in cond) return cond.all.map((c) => describeCondition(c, screens, meta)).join(' וגם ');
  if ('any' in cond) return cond.any.map((c) => describeCondition(c, screens, meta)).join(' או ');
  if ('not' in cond) {
    // שלילה של השוואה פשוטה מתורגמת ל-ne, שמנוסח טוב יותר
    const inner = cond.not;
    if ('q' in inner && (inner.op === 'eq' || inner.op === 'in')) {
      return describeCondition({ q: inner.q, op: 'ne', value: inner.value }, screens, meta);
    }
    return `לא ${describeCondition(inner, screens, meta)}`;
  }

  const isQ = 'q' in cond;
  const ref = isQ ? cond.q : cond.var;
  const screen = isQ ? screens.find((s) => s.id === ref) : undefined;
  const subject = isQ ? '' : varName(meta, ref);

  if (cond.op === 'answered') return isQ ? 'נענתה' : `${subject} קיים`;
  if (cond.op in NUMERIC_OPS) return `${isQ ? '' : subject + ' '}${NUMERIC_OPS[cond.op]} ${cond.value}`;

  const v = isQ
    ? values(screen, cond.value)
    : Array.isArray(cond.value)
      ? cond.value.map((x) => varValue(meta, ref, x)).join(' / ')
      : varValue(meta, ref, cond.value);
  switch (cond.op) {
    case 'eq':
    case 'in':
      return isQ ? v : `${subject}: ${v}`;
    case 'ne':
      return isQ ? (complement(screen, cond.value) ?? `≠ ${v}`) : `${subject} ≠ ${v}`;
    case 'includes':
    case 'includesAny':
      return `כולל ${v}`;
    default:
      return v;
  }
}

/** הטקסט שמייצג את המסך בצומת */
export function nodeText(screen: Screen): string {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return screen.title;
    default:
      return screen.prompt;
  }
}

export function buildFlow(config: SurveyConfig): Flow {
  const screens = config.screens ?? [];
  const meta = config.varMeta ?? {};
  const known = new Set(screens.map((s) => s.id));
  const nodes: FlowNode[] = screens.map((screen) => ({
    id: screen.id,
    screen,
    text: nodeText(screen),
  }));
  const edges: FlowEdge[] = [];

  screens.forEach((screen, i) => {
    if (screen.type === 'end') return;

    const rules = screen.next ?? [];
    let unconditional = false;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      if (known.has(rule.goto)) {
        edges.push({
          from: screen.id,
          to: rule.goto,
          label: rule.if ? describeCondition(rule.if, screens, meta) : 'תמיד',
          conditional: Boolean(rule.if),
          kind: 'goto',
          ruleIndex: r,
        });
      }
      if (!rule.if) {
        unconditional = true;
        break;
      }
    }
    if (unconditional) return;

    // נפילה קדימה: המנוע סורק את המסכים הבאים ועוצר בראשון שעובר showIf.
    // לכן היעד עשוי להיות לא רק המסך הבא אלא כל מסך עד הראשון ללא showIf.
    // הקשת למסך הבא היא הראשית; הרחוקות יותר (דילוג) מוצגות מעומעמות
    // כדי לשמור על קריאות בלי להסתיר מסלולים אמיתיים.
    for (let j = i + 1; j < screens.length; j++) {
      const target = screens[j];
      edges.push({
        from: screen.id,
        to: target.id,
        label: target.showIf
          ? describeCondition(target.showIf, screens, meta)
          : rules.length > 0
            ? 'אחרת'
            : '',
        conditional: Boolean(target.showIf) || rules.length > 0,
        kind: j === i + 1 ? 'primary' : 'skip',
      });
      if (!target.showIf) break;
    }
  });

  return { nodes, edges };
}
