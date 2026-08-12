// לוגיקה טהורה של מסך הסטטיסטיקות: עיצוב תשובת ה-API לאריחי תצוגה ופורמט עברי.
// בכוונה בלי React ובלי רשת — זה התפר שנבדק ביחידות (stats.test.ts).

import type { StatsOverview } from './api';

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
