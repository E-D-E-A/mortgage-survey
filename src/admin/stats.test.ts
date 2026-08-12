// לוגיקת התצוגה הטהורה של מסך הסטטיסטיקות: בניית אריחי הסקירה ופורמט עברי.
// הערכים הצפויים מחושבים ביד — לא נגזרים מהקוד הנבדק.
import { describe, expect, it } from 'vitest';
import { formatCount, formatPercent, overviewTiles } from './stats';
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
});
