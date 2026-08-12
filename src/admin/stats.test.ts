// לוגיקת התצוגה הטהורה של מסך הסטטיסטיקות: בניית אריחי הסקירה ופורמט עברי.
// הערכים הצפויים מחושבים ביד — לא נגזרים מהקוד הנבדק.
import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration, formatPercent, orderFunnel, overviewTiles } from './stats';
import type { StatsOverview } from './api';

const overview: StatsOverview = {
  total_sessions: 60,
  completed: 30,
  screened_out: 12,
  quota_full: 3,
  abandoned_mid: 8,
  abandoned_bounce: 7,
};

describe('overviewTiles', () => {
  it('builds five tiles with hand-computed ratios out of the total', () => {
    const tiles = overviewTiles(overview);
    expect(tiles.map((t) => t.key)).toEqual([
      'total',
      'completed',
      'screened_out',
      'quota_full',
      'abandoned',
    ]);
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(byKey.total.count).toBe(60);
    expect(byKey.total.ratio).toBeNull(); // 100% מעצמו — אין מה להציג
    expect(byKey.completed.count).toBe(30);
    expect(byKey.completed.ratio).toBeCloseTo(0.5);
    expect(byKey.screened_out.ratio).toBeCloseTo(0.2);
    expect(byKey.quota_full.ratio).toBeCloseTo(0.05);
  });

  it('merges the two abandonment kinds into one tile with the split as sub-lines', () => {
    const abandoned = overviewTiles(overview).find((t) => t.key === 'abandoned')!;
    expect(abandoned.count).toBe(15);
    expect(abandoned.ratio).toBeCloseTo(0.25);
    expect(abandoned.sub?.map((s) => s.count)).toEqual([7, 8]); // לא ענו כלל, נטשו באמצע
  });

  it('yields null ratios when there are no sessions at all (empty state, not NaN)', () => {
    const empty = overviewTiles({
      total_sessions: 0,
      completed: 0,
      screened_out: 0,
      quota_full: 0,
      abandoned_mid: 0,
      abandoned_bounce: 0,
    });
    for (const tile of empty) expect(tile.ratio).toBeNull();
  });
});

describe('formatting', () => {
  it('formats counts with Hebrew locale grouping', () => {
    expect(formatCount(1234)).toBe('1,234');
  });

  it('formats ratios as percentages with at most one decimal digit', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(1 / 6)).toBe('16.7%');
    expect(formatPercent(0.0005)).toBe('0.1%');
  });

  it('formats durations as seconds below a minute, m:ss above', () => {
    expect(formatDuration(4000)).toBe('4 שנ׳');
    expect(formatDuration(83000)).toBe('1:23 דק׳');
    expect(formatDuration(null)).toBe('—');
  });
});

// ─── משפך (ENG-14) ──────────────────────────────────────────────────────────

const v2config = {
  version: 'v2',
  screens: [
    { id: 'intro', type: 'info' as const, title: 'פתיח', body: '' },
    { id: 'q1', type: 'single' as const, prompt: 'שאלה 1', options: [] },
    { id: 'q2', type: 'number' as const, prompt: 'שאלה חדשה' },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const v1config = {
  version: 'v1',
  screens: [
    { id: 'intro', type: 'info' as const, title: 'פתיח', body: '' },
    { id: 'q1', type: 'single' as const, prompt: 'שאלה 1', options: [] },
    { id: 'q_old', type: 'number' as const, prompt: 'שאלה ישנה' },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const funnelVersions = [
  { version: 'v2', published_at: '2026-08-05', config: v2config },
  { version: 'v1', published_at: '2026-08-01', config: v1config },
];
const funnelRows = [
  { screen_id: 'q_old', viewed: 4, answered: 4, dropped_here: 0, median_ms: 3000 },
  { screen_id: 'q1', viewed: 10, answered: 8, dropped_here: 1, median_ms: 5000 },
  { screen_id: 'intro', viewed: 12, answered: 0, dropped_here: 2, median_ms: null },
];

describe('orderFunnel', () => {
  it('orders by the latest config when all versions are combined, retired screens greyed at the bottom', () => {
    const rows = orderFunnel(funnelRows, funnelVersions, 'all');
    expect(rows.map((r) => r.screenId)).toEqual(['intro', 'q1', 'q2', 'q_old']);
    expect(rows.map((r) => r.retired)).toEqual([false, false, false, true]);
    // תוויות מהקונפיג; מסך שפרש נשאר עם המזהה הגולמי
    expect(rows[0].label).toBe('פתיח');
    expect(rows[1].label).toBe('שאלה 1');
    expect(rows[3].label).toBe('q_old');
  });

  it('zero-fills config screens nobody reached, and never lists end screens', () => {
    const rows = orderFunnel(funnelRows, funnelVersions, 'all');
    const q2 = rows.find((r) => r.screenId === 'q2')!;
    expect(q2).toMatchObject({ viewed: 0, answered: 0, droppedHere: 0, medianMs: null });
    expect(rows.some((r) => r.screenId === 'end')).toBe(false);
  });

  it("uses the selected version's own config when one version is chosen", () => {
    const rows = orderFunnel(funnelRows, funnelVersions, 'v1');
    expect(rows.map((r) => r.screenId)).toEqual(['intro', 'q1', 'q_old']);
    expect(rows.every((r) => !r.retired)).toBe(true);
    expect(rows[2].label).toBe('שאלה ישנה');
  });
});
