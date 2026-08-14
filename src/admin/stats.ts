// לוגיקה טהורה של מסך הסטטיסטיקות: עיצוב תשובת ה-API לאריחי תצוגה ופורמט עברי.
// בכוונה בלי React ובלי רשת — זה התפר שנבדק ביחידות (stats.test.ts).

import type { Screen, SurveyConfig } from '../engine/types';
import type { BaseStat, DistStat, FunnelStat, StatsOverview, StatsVersion } from './api';

export interface OverviewTile {
  key: 'total' | 'completed' | 'screened_out' | 'quota_full' | 'abandoned';
  label: string;
  count: number;
  /** שיעור מתוך סה״כ הסשנים; null כשאין ממה לחשב (אפס סשנים, או האריח הכולל) */
  ratio: number | null;
  /** פירוט משני — פיצול הנטישה לשני סוגיה */
  sub?: { label: string; count: number }[];
}

export function overviewTiles(o: StatsOverview): OverviewTile[] {
  const total = o.total_sessions;
  const ratio = (n: number) => (total > 0 ? n / total : null);
  const abandoned = o.abandoned_mid + o.abandoned_bounce;
  return [
    { key: 'total', label: 'סה״כ סשנים', count: total, ratio: null },
    { key: 'completed', label: 'הושלמו', count: o.completed, ratio: ratio(o.completed) },
    { key: 'screened_out', label: 'סוננו', count: o.screened_out, ratio: ratio(o.screened_out) },
    { key: 'quota_full', label: 'מכסה מלאה', count: o.quota_full, ratio: ratio(o.quota_full) },
    {
      key: 'abandoned',
      label: 'נטישה',
      count: abandoned,
      ratio: ratio(abandoned),
      // הסדר קבוע: קודם מי שלא ענה כלל (בעיית קישור/בוטים), אז נטישת אמצע
      // (בעיית שאלון) — אבחנת ה-QC המרכזית של פיילוט
      sub: [
        { label: 'נכנסו ולא ענו כלל', count: o.abandoned_bounce },
        { label: 'התחילו לענות ונטשו', count: o.abandoned_mid },
      ],
    },
  ];
}

const nf = new Intl.NumberFormat('he-IL');

export const formatCount = (n: number): string => nf.format(n);

/** אחוז עם ספרה עשרונית אחת לכל היותר: 50% · 16.7% */
export const formatPercent = (ratio: number): string => `${nf.format(Math.round(ratio * 1000) / 10)}%`;

/** משך במסך: שניות מתחת לדקה, m:ss מעליה; null (אין תשובות) → קו מפריד */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${nf.format(totalSec)} שנ׳`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')} דק׳`;
}

// ─── משפך (ENG-14) ──────────────────────────────────────────────────────────

export interface FunnelRow {
  screenId: string;
  label: string;
  viewed: number;
  answered: number;
  droppedHere: number;
  medianMs: number | null;
  retired: boolean;
}

const screenLabel = (s: Screen): string =>
  'prompt' in s && s.prompt ? s.prompt : 'title' in s && s.title ? s.title : s.id;

/** הקונפיג שמכתיב סדר ותוויות: האחרון ב"כל הגרסאות", או הגרסה שנבחרה */
export const chosenConfig = (versions: StatsVersion[], selected: string): SurveyConfig | undefined =>
  (selected === 'all' ? versions[0] : versions.find((v) => v.version === selected))?.config;

/**
 * סדר שורות המשפך נקבע ע"י קונפיג — לאירועים עצמם אין סדר. ב"כל הגרסאות"
 * מסדרת הגרסה האחרונה, ומסכים שקיימים רק בגרסאות ישנות מצטרפים בסוף
 * כ"פורשים" (retired) עם המזהה הגולמי — סשן אמיתי לא נעלם מהסיפור.
 * מסך שאיש לא הגיע אליו מקבל אפסים; מסכי end אינם חלק מהמשפך (הם התוצאה).
 */
export function orderFunnel(
  rows: FunnelStat[],
  versions: StatsVersion[],
  selected: string,
): FunnelRow[] {
  const config = chosenConfig(versions, selected);
  const byId = new Map(rows.map((r) => [r.screen_id, r]));
  const out: FunnelRow[] = [];
  const inConfig = new Set<string>();

  for (const screen of config?.screens ?? []) {
    if (screen.type === 'end') continue;
    inConfig.add(screen.id);
    const r = byId.get(screen.id);
    out.push({
      screenId: screen.id,
      label: screenLabel(screen),
      viewed: r?.viewed ?? 0,
      answered: r?.answered ?? 0,
      droppedHere: r?.dropped_here ?? 0,
      medianMs: r?.median_ms ?? null,
      retired: false,
    });
  }

  const retired = rows
    .filter((r) => !inConfig.has(r.screen_id))
    .sort((a, b) => a.screen_id.localeCompare(b.screen_id));
  for (const r of retired) {
    out.push({
      screenId: r.screen_id,
      label: r.screen_id,
      viewed: r.viewed,
      answered: r.answered,
      droppedHere: r.dropped_here,
      medianMs: r.median_ms,
      retired: true,
    });
  }
  return out;
}

// ─── כרטיסי התפלגות (ENG-15/17) ─────────────────────────────────────────────

export interface BarGroup {
  key: string | null;
  count: number;
  /** שיעור מתוך העונים בקבוצת המימד (המכנה מ-stats_bases) */
  ratio: number | null;
}

export interface ChoiceBar {
  id: string;
  label: string;
  count: number;
  /** שיעור מתוך העונים על השאלה (base); ברב-ברירה הסכום עשוי לעבור 100% */
  ratio: number | null;
  /** אפשרות שקיימת בנתונים אך לא בקונפיג הנוכחי — מוצגת עם המזהה הגולמי */
  retiredOption?: boolean;
  /** בפילוח פעיל: תת-עמודה לכל ערך מימד, בסדר המקרא */
  groups?: BarGroup[];
}

export type ClosedType = 'single' | 'multi' | 'matrix' | 'number';

export interface MatrixItemVariant {
  key: string | null;
  counts: Record<string, number>;
  na: number;
  n: number;
  mean: number | null;
}

export interface MatrixItemModel {
  id: string;
  label: string;
  /** ספירה לפי מפתח ציון ('1'..'5'); na אינו כאן */
  counts: Record<string, number>;
  na: number;
  /** מספר העונים המספריים (בלי na) */
  n: number;
  /** ממוצע הציונים המספריים; null כשאין אף ציון */
  mean: number | null;
  /** פריט שקיים בנתונים אך לא בקונפיג הנוכחי */
  retiredItem?: boolean;
  /** בפילוח פעיל: אותו חישוב לכל ערך מימד בנפרד, בסדר המקרא */
  variants?: MatrixItemVariant[];
}

export interface MatrixCardModel {
  scaleMin: number;
  scaleMax: number;
  minLabel: string;
  maxLabel: string;
  naLabel?: string;
  items: MatrixItemModel[];
}

export interface QuestionCardModel {
  screenId: string;
  label: string;
  type: ClosedType;
  /** כמה ענו על השאלה (בסיס האחוזים) — נגזר מנתוני המשפך */
  base: number;
  /** מספר הגרסאות המשולבות כשסט התשובות שונה ביניהן; null = אין מה להעיר */
  spansVersions: number | null;
  /** single/multi בלבד */
  bars?: ChoiceBar[];
  /** מטריצה בלבד */
  matrix?: MatrixCardModel;
  /** number בלבד: ערכים מספריים ממוינים — ה-binning קורה בהיסטוגרמה */
  numberValues?: { value: number; count: number }[];
  /** האטומים הגולמיים של המסך */
  atoms: DistStat[];
}

const CLOSED_TYPES = new Set<Screen['type']>(['single', 'multi', 'matrix', 'number']);

/** זהות סט-התשובות של שאלה בגרסה — השוואה בין גרסאות להערת "מתפרס על N גרסאות" */
function answerSetKey(screen: Screen): string {
  switch (screen.type) {
    case 'single':
    case 'multi':
      return screen.options.map((o) => o.id).join('|');
    case 'matrix':
      return `${screen.items.map((i) => i.id).join('|')}#${screen.scaleMin}-${screen.scaleMax}#${screen.naLabel ?? ''}`;
    default:
      return '';
  }
}

/**
 * מודל כרטיס לכל שאלה סגורה, בסדר הקונפיג הקובע. תוויות — מהקונפיג; מפתח
 * שקיים בנתונים אך לא בקונפיג (אפשרות שהוסרה) מצטרף בסוף עם המזהה הגולמי.
 * שאלות פתוחות (text) אינן כאן בכוונה — הן מוצגות כלשונן בלשונית הנפרדת,
 * בלי שום ניתוח תוכן. consent/info שייכים למשפך, לא להתפלגויות.
 */
export function questionCards(
  dist: DistStat[],
  funnel: FunnelStat[],
  versions: StatsVersion[],
  selected: string,
  split?: SplitSpec,
): QuestionCardModel[] {
  const config = chosenConfig(versions, selected);
  if (!config) return [];
  // base = "ענו" מהמשפך (סשנים עם אירוע answer כלשהו). לשאלות סגורות זה שווה
  // בהגדרה למספר התשובות הסופיות שאינן null — תשובת null קיימת רק בשאלות
  // טקסט (דילוג מכוון), ולהן אין כרטיס. מכני הפילוח (stats_bases) סופרים
  // תשובות סופיות לא-null — אותו מספר בדיוק עבור המסכים שמצוירים כאן.
  const answeredBy = new Map(funnel.map((f) => [f.screen_id, f.answered]));
  const byScreen = new Map<string, DistStat[]>();
  for (const row of dist) {
    const list = byScreen.get(row.screen_id) ?? [];
    list.push(row);
    byScreen.set(row.screen_id, list);
  }

  const cards: QuestionCardModel[] = [];
  for (const screen of config.screens) {
    if (!CLOSED_TYPES.has(screen.type)) continue;
    const type = screen.type as ClosedType;
    const atoms = byScreen.get(screen.id) ?? [];
    const base = answeredBy.get(screen.id) ?? 0;

    let spansVersions: number | null = null;
    if (selected === 'all' && versions.length > 1) {
      const keys = new Set<string>();
      let appearsIn = 0;
      for (const v of versions) {
        const s = v.config.screens.find((c) => c.id === screen.id);
        if (!s) continue;
        appearsIn += 1;
        keys.add(answerSetKey(s));
      }
      if (appearsIn > 1 && keys.size > 1) spansVersions = appearsIn;
    }

    let bars: ChoiceBar[] | undefined;
    if (screen.type === 'single' || screen.type === 'multi') {
      // בפילוח פעיל יש שורה לכל (מפתח, מימד) — הסכימה כאן, לא הנחת שורה-למפתח
      const totals = new Map<string, number>();
      for (const a of atoms) totals.set(a.answer_key, (totals.get(a.answer_key) ?? 0) + a.n);
      bars = screen.options.map((o) => ({
        id: o.id,
        label: o.label,
        count: totals.get(o.id) ?? 0,
        ratio: base > 0 ? (totals.get(o.id) ?? 0) / base : null,
      }));
      const known = new Set(bars.map((b) => b.id));
      for (const [key, count] of totals) {
        if (known.has(key)) continue;
        bars.push({
          id: key,
          label: key,
          count,
          ratio: base > 0 ? count / base : null,
          retiredOption: true,
        });
      }
      if (split && split.legend.mode === 'ok') {
        // מפתח מורכב חד-משמעי — מזהי אפשרויות וערכי מימד יכולים להכיל כל תו
        const byDim = new Map<string, number>();
        for (const a of atoms) byDim.set(JSON.stringify([a.answer_key, a.dim_value]), a.n);
        const baseOf = new Map(
          split.bases
            .filter((b) => b.screen_id === screen.id)
            .map((b) => [JSON.stringify(b.dim_value), b.answered]),
        );
        for (const bar of bars) {
          bar.groups = split.legend.values.map((v) => {
            const count = byDim.get(JSON.stringify([bar.id, v.key])) ?? 0;
            const groupBase = baseOf.get(JSON.stringify(v.key)) ?? 0;
            return { key: v.key, count, ratio: groupBase > 0 ? count / groupBase : null };
          });
        }
      }
    }

    let matrix: MatrixCardModel | undefined;
    if (screen.type === 'matrix') {
      const byItem = new Map<string, DistStat[]>();
      for (const a of atoms) {
        if (a.item_id === null) continue;
        const list = byItem.get(a.item_id) ?? [];
        list.push(a);
        byItem.set(a.item_id, list);
      }
      const tally = (rows: DistStat[]) => {
        const counts: Record<string, number> = {};
        let na = 0;
        let n = 0;
        let sum = 0;
        for (const a of rows) {
          const score = Number(a.answer_key);
          if (Number.isFinite(score)) {
            counts[a.answer_key] = (counts[a.answer_key] ?? 0) + a.n;
            n += a.n;
            sum += score * a.n;
          } else {
            na += a.n;
          }
        }
        return { counts, na, n, mean: n > 0 ? sum / n : null };
      };
      const buildItem = (id: string, label: string, retiredItem?: boolean): MatrixItemModel => {
        const rows = byItem.get(id) ?? [];
        const item: MatrixItemModel = { id, label, ...tally(rows), retiredItem };
        if (split && split.legend.mode === 'ok') {
          item.variants = split.legend.values.map((v) => ({
            key: v.key,
            ...tally(rows.filter((a) => a.dim_value === v.key)),
          }));
        }
        return item;
      };
      const items = screen.items.map((i) => buildItem(i.id, i.label));
      const known = new Set(screen.items.map((i) => i.id));
      for (const id of [...byItem.keys()].sort()) {
        if (!known.has(id)) items.push(buildItem(id, id, true));
      }
      matrix = {
        scaleMin: screen.scaleMin,
        scaleMax: screen.scaleMax,
        minLabel: screen.minLabel,
        maxLabel: screen.maxLabel,
        naLabel: screen.naLabel,
        items,
      };
    }

    let numberValues: { value: number; count: number }[] | undefined;
    if (screen.type === 'number') {
      // סכימה פר ערך — בפילוח אותו ערך מגיע בשורה לכל מימד
      const perValue = new Map<number, number>();
      for (const a of atoms) {
        const value = Number(a.answer_key);
        if (Number.isFinite(value)) perValue.set(value, (perValue.get(value) ?? 0) + a.n);
      }
      numberValues = [...perValue.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value - b.value);
    }

    cards.push({
      screenId: screen.id,
      label: screenLabel(screen),
      type,
      base,
      spansVersions,
      bars,
      matrix,
      numberValues,
      atoms,
    });
  }
  return cards;
}

// ─── פילוח (ENG-18) ─────────────────────────────────────────────────────────

export interface DimensionOption {
  key: string;
  label: string;
}

/**
 * המימדים המוצעים לפילוח: משתני varMeta (התוויות שלהם), משתני randomVars
 * (זרועות ניסוי), מקור ההגעה url_source, ותוצאת הסשן. בכוונה לא כל url_*
 * (מזהי פאנל = קרדינליות של אדם-לערך).
 */
export function dimensionOptions(versions: StatsVersion[], selected: string): DimensionOption[] {
  const config = chosenConfig(versions, selected);
  const out: DimensionOption[] = [];
  const seen = new Set<string>();
  for (const [key, meta] of Object.entries(config?.varMeta ?? {})) {
    out.push({ key, label: meta.label || key });
    seen.add(key);
  }
  for (const key of Object.keys(config?.randomVars ?? {})) {
    if (!seen.has(key)) out.push({ key, label: key });
  }
  out.push({ key: 'url_source', label: 'מקור הגעה' });
  out.push({ key: '_outcome', label: 'תוצאת הסשן' });
  return out;
}

/** ערך מימד במקרא: key=null הוא "לא ידוע" (סשן בלי ערך למימד) */
export interface DimValue {
  key: string | null;
  label: string;
  color: string;
}

export interface DimensionLegend {
  /** refused = יותר מ-12 ערכים — אין דרך לצייר את זה בכנות */
  mode: 'ok' | 'refused';
  values: DimValue[];
  distinct: number;
}

/**
 * פלטת הסדרות: סדר הגוונים הקבוע של מיומנות ה-dataviz (מאומת ל-CVD בסדר
 * הזה — הסדר הוא מנגנון הבטיחות, לא קוסמטיקה). הצבע צמוד לזהות הערך, לא
 * לשכיחות שלו. אפור שמור ל"לא ידוע" ואינו חלק מהסדרה.
 */
const SERIES_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const UNKNOWN_COLOR = '#9ca3af';

const OUTCOME_ORDER = ['complete', 'screenout', 'quotafull', 'abandoned_mid', 'abandoned_bounce'];
const OUTCOME_LABELS: Record<string, string> = {
  complete: 'הושלמו',
  screenout: 'סוננו',
  quotafull: 'מכסה מלאה',
  abandoned_mid: 'נטשו באמצע',
  abandoned_bounce: 'לא ענו כלל',
};

/** תווית עברית לתוצאת סשן בשורת תשובה בודדת (abandoned = כל נטישה) */
export const outcomeLabel = (outcome: string): string =>
  outcome === 'abandoned' ? 'נטישה' : (OUTCOME_LABELS[outcome] ?? outcome);

/** שאלות הטקסט של הקונפיג הקובע — הרשימה שלשונית התשובות הפתוחות מדפדפת */
export function textScreens(
  versions: StatsVersion[],
  selected: string,
): { id: string; label: string }[] {
  const config = chosenConfig(versions, selected);
  return (config?.screens ?? [])
    .filter((s) => s.type === 'text')
    .map((s) => ({ id: s.id, label: screenLabel(s) }));
}

export const MAX_DIMENSION_VALUES = 12;

export function dimensionLegend(
  dist: DistStat[],
  by: string,
  config: SurveyConfig | undefined,
): DimensionLegend {
  const present = new Set<string>();
  let hasUnknown = false;
  for (const row of dist) {
    if (row.dim_value === null) hasUnknown = true;
    else present.add(row.dim_value);
  }
  // "לא ידוע" הוא עמודה בתרשים לכל דבר — נספר בתקרה יחד עם הערכים הידועים
  const distinct = present.size + (hasUnknown ? 1 : 0);
  if (distinct > MAX_DIMENSION_VALUES) {
    return { mode: 'refused', values: [], distinct };
  }

  // סדר יציב שאינו תלוי בשכיחות: הסדר המוצהר (varMeta / סדר התוצאות הקבוע),
  // וערכים שאינם מוצהרים — לקסיקוגרפית. כך פילטר לא "צובע מחדש" קבוצות.
  const declared =
    by === '_outcome'
      ? OUTCOME_ORDER
      : Object.keys(config?.varMeta?.[by]?.values ?? {});
  const ordered = [
    ...declared.filter((v) => present.has(v)),
    ...[...present].filter((v) => !declared.includes(v)).sort(),
  ];

  const labelOf = (v: string): string =>
    by === '_outcome' ? (OUTCOME_LABELS[v] ?? v) : (config?.varMeta?.[by]?.values?.[v] ?? v);

  const values: DimValue[] = ordered.map((v, i) => ({
    key: v,
    label: labelOf(v),
    color: SERIES_PALETTE[i % SERIES_PALETTE.length],
  }));
  if (hasUnknown) values.push({ key: null, label: 'לא ידוע', color: UNKNOWN_COLOR });
  return { mode: 'ok', values, distinct };
}

export interface SplitSpec {
  legend: DimensionLegend;
  bases: BaseStat[];
}

// ─── היסטוגרמה (ENG-17) ─────────────────────────────────────────────────────

export interface NumberBin {
  from: number;
  to: number;
  count: number;
}

/** רוחב-סל "נקי": 1/2/5 × 10^k — הקרוב מלמעלה לרוחב הגולמי */
function niceWidth(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * חלוקת ערכים לסלים בגבולות עגולים: הרוחב נבחר כך שמספר הסלים ≤ target,
 * והקצוות מיושרים לכפולות הרוחב — "0–500,000" ולא "400,123–723,456".
 */
export function binNumbers(
  values: { value: number; count: number }[],
  targetBins: number,
): NumberBin[] {
  if (values.length === 0) return [];
  const min = values[0].value;
  const max = values[values.length - 1].value;
  if (min === max) return [{ from: min, to: min + 1, count: values.reduce((s, v) => s + v.count, 0) }];

  const width = niceWidth((max - min) / targetBins);
  const start = Math.floor(min / width) * width;
  const binCount = Math.floor((max - start) / width) + 1;
  const bins: NumberBin[] = Array.from({ length: binCount }, (_, i) => ({
    from: start + i * width,
    to: start + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    bins[Math.min(Math.floor((v.value - start) / width), binCount - 1)].count += v.count;
  }
  return bins;
}

/** מפתח-מימד לספירות ההיסטוגרמה: null (לא ידוע) מקבל מפתח שמור */
export const UNKNOWN_DIM_KEY = '__unknown__';

export interface NumberBinByDim {
  from: number;
  to: number;
  /** ספירה לכל ערך מימד; המפתח לערך לא-ידוע הוא UNKNOWN_DIM_KEY */
  counts: Record<string, number>;
}

/** היסטוגרמה מפולחת: אותם סלים לכל הקבוצות (השוואה בין קבוצות דורשת צירים זהים) */
export function binNumbersByDim(atoms: DistStat[], targetBins: number): NumberBinByDim[] {
  const numeric = atoms
    .map((a) => ({ value: Number(a.answer_key), dim: a.dim_value, count: a.n }))
    .filter((v) => Number.isFinite(v.value))
    .sort((a, b) => a.value - b.value);
  const combined = new Map<number, number>();
  for (const v of numeric) combined.set(v.value, (combined.get(v.value) ?? 0) + v.count);
  const shape = binNumbers(
    [...combined.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value),
    targetBins,
  );
  const bins: NumberBinByDim[] = shape.map((b) => ({ from: b.from, to: b.to, counts: {} }));
  if (bins.length === 0) return bins;
  const width = bins[0].to - bins[0].from;
  const start = bins[0].from;
  for (const v of numeric) {
    const idx = Math.min(Math.floor((v.value - start) / width), bins.length - 1);
    const key = v.dim ?? UNKNOWN_DIM_KEY;
    bins[idx].counts[key] = (bins[idx].counts[key] ?? 0) + v.count;
  }
  return bins;
}
