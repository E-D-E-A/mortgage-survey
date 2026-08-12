// לוגיקה טהורה של מסך הסטטיסטיקות: עיצוב תשובת ה-API לאריחי תצוגה ופורמט עברי.
// בכוונה בלי React ובלי רשת — זה התפר שנבדק ביחידות (stats.test.ts).

import type { Screen, SurveyConfig } from '../engine/types';
import type { DistStat, FunnelStat, StatsOverview, StatsVersion } from './api';

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
const chosenConfig = (versions: StatsVersion[], selected: string): SurveyConfig | undefined =>
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

export interface ChoiceBar {
  id: string;
  label: string;
  count: number;
  /** שיעור מתוך העונים על השאלה (base); ברב-ברירה הסכום עשוי לעבור 100% */
  ratio: number | null;
  /** אפשרות שקיימת בנתונים אך לא בקונפיג הנוכחי — מוצגת עם המזהה הגולמי */
  retiredOption?: boolean;
}

export type ClosedType = 'single' | 'multi' | 'matrix' | 'number';

export interface QuestionCardModel {
  screenId: string;
  label: string;
  type: ClosedType;
  /** כמה ענו על השאלה (בסיס האחוזים) — נגזר מנתוני המשפך */
  base: number;
  /** מספר הגרסאות המשולבות כשסט התשובות שונה ביניהן; null = אין מה להעיר */
  spansVersions: number | null;
  /** single/multi בלבד; מטריצות ומספרים נבנים מ-atoms בכרטיסים שלהם */
  bars?: ChoiceBar[];
  /** האטומים הגולמיים של המסך — למטריצה ולהיסטוגרמה */
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
): QuestionCardModel[] {
  const config = chosenConfig(versions, selected);
  if (!config) return [];
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
    if (type === 'single' || type === 'multi') {
      const counts = new Map(atoms.map((a) => [a.answer_key, a.n]));
      bars = screen.type === 'single' || screen.type === 'multi'
        ? screen.options.map((o) => ({
            id: o.id,
            label: o.label,
            count: counts.get(o.id) ?? 0,
            ratio: base > 0 ? (counts.get(o.id) ?? 0) / base : null,
          }))
        : [];
      const known = new Set(bars.map((b) => b.id));
      for (const a of atoms) {
        if (known.has(a.answer_key)) continue;
        bars.push({
          id: a.answer_key,
          label: a.answer_key,
          count: a.n,
          ratio: base > 0 ? a.n / base : null,
          retiredOption: true,
        });
      }
    }

    cards.push({ screenId: screen.id, label: screenLabel(screen), type, base, spansVersions, bars, atoms });
  }
  return cards;
}
