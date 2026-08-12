// לוגיקה טהורה של מסך הסטטיסטיקות: עיצוב תשובת ה-API לאריחי תצוגה ופורמט עברי.
// בכוונה בלי React ובלי רשת — זה התפר שנבדק ביחידות (stats.test.ts).

import type { Screen } from '../engine/types';
import type { FunnelStat, StatsOverview, StatsVersion } from './api';

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
  const chosen = selected === 'all' ? versions[0] : versions.find((v) => v.version === selected);
  const byId = new Map(rows.map((r) => [r.screen_id, r]));
  const out: FunnelRow[] = [];
  const inConfig = new Set<string>();

  for (const screen of chosen?.config.screens ?? []) {
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
