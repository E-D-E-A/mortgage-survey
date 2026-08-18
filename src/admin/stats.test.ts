// The statistics screen's pure display logic: building the overview tiles and the
// Hebrew formatting. The expected values are computed by hand — never derived from
// the code under test.
import { describe, expect, it } from 'vitest';
import {
  answerFilters,
  binNumbers,
  binNumbersByDim,
  dimensionLegend,
  dimensionOptions,
  formatCount,
  formatDuration,
  formatPercent,
  orderFunnel,
  overviewTiles,
  questionCards,
} from './stats';
import type { StatsOverview, StatsVersion } from './api';
import type { SurveyConfig } from '../engine/types';

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
    expect(byKey.total.ratio).toBeNull(); // 100% of itself — there is nothing to show
    expect(byKey.completed.count).toBe(30);
    expect(byKey.completed.ratio).toBeCloseTo(0.5);
    expect(byKey.screened_out.ratio).toBeCloseTo(0.2);
    expect(byKey.quota_full.ratio).toBeCloseTo(0.05);
  });

  it('merges the two abandonment kinds into one tile with the split as sub-lines', () => {
    const abandoned = overviewTiles(overview).find((t) => t.key === 'abandoned')!;
    expect(abandoned.count).toBe(15);
    expect(abandoned.ratio).toBeCloseTo(0.25);
    expect(abandoned.sub?.map((s) => s.count)).toEqual([7, 8]); // never answered, abandoned mid-survey
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

// ─── the funnel (ENG-14) ───────────────────────────────────────────────────

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

// ─── distribution cards (ENG-15) ───────────────────────────────────────────

const dv2 = {
  version: 'v2',
  screens: [
    { id: 'intro', type: 'info' as const, title: 'פתיח', body: '' },
    {
      id: 's_status',
      type: 'single' as const,
      prompt: 'מה מצבך?',
      options: [
        { id: 'active', label: 'פעילה' },
        { id: 'planning', label: 'מתכנן' },
        { id: 'considering', label: 'שוקל' },
      ],
    },
    {
      id: 'goals',
      type: 'multi' as const,
      prompt: 'מה חשוב?',
      options: [
        { id: 'rate', label: 'ריבית' },
        { id: 'flex', label: 'גמישות' },
      ],
    },
    { id: 'why', type: 'text' as const, prompt: 'ספרו לנו' },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const dv1 = {
  version: 'v1',
  screens: [
    {
      id: 's_status',
      // v1 without considering — a different option set ⇒ the multi-version note
      type: 'single' as const,
      prompt: 'מה מצבך?',
      options: [
        { id: 'active', label: 'פעילה' },
        { id: 'planning', label: 'מתכנן' },
      ],
    },
    {
      id: 'goals',
      type: 'multi' as const,
      prompt: 'מה חשוב?',
      options: [
        { id: 'rate', label: 'ריבית' },
        { id: 'flex', label: 'גמישות' },
      ],
    },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const distVersions = [
  { version: 'v2', published_at: '2026-08-05', config: dv2 },
  { version: 'v1', published_at: '2026-08-01', config: dv1 },
];
const distRows = [
  { screen_id: 's_status', item_id: null, answer_key: 'active', dim_value: null, n: 6 },
  { screen_id: 's_status', item_id: null, answer_key: 'planning', dim_value: null, n: 3 },
  { screen_id: 's_status', item_id: null, answer_key: 'old_removed', dim_value: null, n: 1 },
  { screen_id: 'goals', item_id: null, answer_key: 'rate', dim_value: null, n: 7 },
  { screen_id: 'goals', item_id: null, answer_key: 'flex', dim_value: null, n: 5 },
];
const distFunnel = [
  { screen_id: 's_status', viewed: 12, answered: 10, dropped_here: 0, median_ms: 4000 },
  { screen_id: 'goals', viewed: 9, answered: 8, dropped_here: 1, median_ms: 6000 },
];

describe('questionCards', () => {
  const cards = () => questionCards(distRows, distFunnel, distVersions, 'all');

  it('builds cards only for closed questions, in latest-config order, base N from the funnel', () => {
    expect(cards().map((c) => [c.screenId, c.type])).toEqual([
      ['s_status', 'single'],
      ['goals', 'multi'],
    ]);
    expect(cards()[0].base).toBe(10);
    expect(cards()[1].base).toBe(8);
  });

  it('orders bars by config, resolves labels, appends removed options with their raw id', () => {
    const status = cards()[0];
    expect(status.bars!.map((b) => [b.id, b.label, b.count])).toEqual([
      ['active', 'פעילה', 6],
      ['planning', 'מתכנן', 3],
      ['considering', 'שוקל', 0],
      ['old_removed', 'old_removed', 1],
    ]);
    expect(status.bars![3].retiredOption).toBe(true);
    // A share of those who answered the question
    expect(status.bars![0].ratio).toBeCloseTo(0.6);
  });

  it('multi-choice ratios are percent of respondents and may sum past 100%', () => {
    const goals = cards()[1];
    expect(goals.bars!.map((b) => b.ratio)).toEqual([7 / 8, 5 / 8]);
  });

  it('notes when the option set differs across combined versions, and only then', () => {
    const [status, goals] = cards();
    expect(status.spansVersions).toBe(2);
    expect(goals.spansVersions).toBeNull();
    // With a single version there is nothing to note
    const single = questionCards(distRows, distFunnel, distVersions, 'v2');
    expect(single[0].spansVersions).toBeNull();
  });
});

// ─── breakdowns (ENG-18) ───────────────────────────────────────────────────

const bdConfig = {
  version: 'b1',
  randomVars: { price: [1200, 1900] },
  varMeta: {
    segment: {
      label: 'מסלול המשיב',
      values: { A: 'יש משכנתה', B: 'לקראת', C: 'לא רלוונטי' },
    },
  },
  screens: [
    {
      id: 'q1',
      type: 'single' as const,
      prompt: 'שאלה',
      options: [
        { id: 'x', label: 'איקס' },
        { id: 'y', label: 'וואי' },
      ],
    },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const bdVersions = [{ version: 'b1', published_at: '2026-08-01', config: bdConfig }];

describe('dimensionOptions', () => {
  it('offers varMeta vars, randomVars, url_source and outcome — nothing else', () => {
    expect(dimensionOptions(bdVersions, 'all')).toEqual([
      { key: 'segment', label: 'מסלול המשיב' },
      { key: 'price', label: 'price' },
      { key: 'url_source', label: 'מקור הגעה' },
      { key: '_outcome', label: 'תוצאת הסשן' },
    ]);
  });

  it('offers url_source alone, never another url_ parameter the survey happens to collect', () => {
    // The config above has no second url_ var, so on its own it cannot tell
    // "only url_source" apart from "any url_ it finds". This one can: both
    // url_campaign and url_medium are real session vars here, set by a screen.
    const withParams = {
      ...bdConfig,
      screens: [
        {
          id: 'q1',
          type: 'info' as const,
          title: 'שאלה',
          body: '',
          onSubmit: [
            { var: 'url_campaign', value: 'spring' },
            { var: 'url_medium', value: 'cpc' },
          ],
        },
        { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
      ],
    };
    const keys = dimensionOptions(
      [{ version: 'b1', published_at: '2026-08-01', config: withParams }],
      'all',
    ).map((d) => d.key);
    expect(keys).toContain('url_source');
    expect(keys).not.toContain('url_campaign');
    expect(keys).not.toContain('url_medium');
  });
});

describe('dimensionLegend', () => {
  const rows = (values: (string | null)[]) =>
    values.map((v, i) => ({ screen_id: 'q1', item_id: null, answer_key: 'x', dim_value: v, n: i + 1 }));

  it('orders varMeta values by their declared order, labels them, and puts unknown last in gray', () => {
    const legend = dimensionLegend(rows(['B', null, 'A']), 'segment', bdConfig);
    expect(legend.mode).toBe('ok');
    expect(legend.values.map((v) => [v.key, v.label])).toEqual([
      ['A', 'יש משכנתה'],
      ['B', 'לקראת'],
      [null, 'לא ידוע'],
    ]);
    // The colour follows identity: A is always first in the palette, even when B is more common
    expect(legend.values[0].color).not.toBe(legend.values[1].color);
    expect(legend.values[2].color).toBe('#9ca3af');
  });

  it('gives the outcome dimension its fixed order and Hebrew labels', () => {
    const legend = dimensionLegend(rows(['abandoned_mid', 'complete']), '_outcome', bdConfig);
    expect(legend.values.map((v) => v.label)).toEqual(['הושלמו', 'נטשו באמצע']);
  });

  it('refuses a dimension with more than 12 values — the unknown bucket counts too', () => {
    const many = rows(Array.from({ length: 13 }, (_, i) => `v${i}`));
    expect(dimensionLegend(many, 'url_source', bdConfig).mode).toBe('refused');
    // 12 known values + "unknown" = 13 bars in practice — that is refused too
    const twelvePlusUnknown = rows([...Array.from({ length: 12 }, (_, i) => `v${i}`), null]);
    expect(dimensionLegend(twelvePlusUnknown, 'url_source', bdConfig).mode).toBe('refused');
    // Exactly 12 including the unknown one — accepted
    const okSet = rows([...Array.from({ length: 11 }, (_, i) => `v${i}`), null]);
    expect(dimensionLegend(okSet, 'url_source', bdConfig).mode).toBe('ok');
  });
});

describe('questionCards with a split', () => {
  const dist = [
    { screen_id: 'q1', item_id: null, answer_key: 'x', dim_value: 'A', n: 2 },
    { screen_id: 'q1', item_id: null, answer_key: 'x', dim_value: null, n: 1 },
    { screen_id: 'q1', item_id: null, answer_key: 'y', dim_value: 'B', n: 1 },
  ];
  const funnel = [{ screen_id: 'q1', viewed: 5, answered: 4, dropped_here: 0, median_ms: 3000 }];
  const bases = [
    { screen_id: 'q1', dim_value: 'A', answered: 2 },
    { screen_id: 'q1', dim_value: 'B', answered: 1 },
    { screen_id: 'q1', dim_value: null, answered: 1 },
  ];

  it('each bar splits into ordered groups with per-group percent denominators', () => {
    const legend = dimensionLegend(dist, 'segment', bdConfig);
    const [card] = questionCards(dist, funnel, bdVersions, 'all', { legend, bases });
    const x = card.bars!.find((b) => b.id === 'x')!;
    expect(x.groups!.map((g) => [g.key, g.count, g.ratio])).toEqual([
      ['A', 2, 1], // every respondent in group A answered x
      ['B', 0, 0],
      [null, 1, 1],
    ]);
    const y = card.bars!.find((b) => b.id === 'y')!;
    expect(y.groups![1]).toEqual({ key: 'B', count: 1, ratio: 1 });
  });

  it('matrix items grow per-dimension variants; histogram bins split per dimension', () => {
    const mDist = [
      { screen_id: 'trust', item_id: 'bank', answer_key: '4', dim_value: 'A', n: 2 },
      { screen_id: 'trust', item_id: 'bank', answer_key: '2', dim_value: 'B', n: 1 },
      { screen_id: 'budget', item_id: null, answer_key: '7', dim_value: 'A', n: 2 },
      { screen_id: 'budget', item_id: null, answer_key: '12', dim_value: 'B', n: 1 },
    ];
    const mFunnel = [
      { screen_id: 'trust', viewed: 3, answered: 3, dropped_here: 0, median_ms: 1000 },
      { screen_id: 'budget', viewed: 3, answered: 3, dropped_here: 0, median_ms: 1000 },
    ];
    const legend = dimensionLegend(mDist, 'segment', bdConfig);
    const [trust, budget] = questionCards(mDist, mFunnel, mxVersions, 'all', {
      legend,
      bases: [],
    });
    const bank = trust.matrix!.items[0];
    expect(bank.variants!.map((v) => [v.key, v.mean, v.n])).toEqual([
      ['A', 4, 2],
      ['B', 2, 1],
    ]);
    const bins = binNumbersByDim(budget.atoms, 7);
    expect(bins[0]).toMatchObject({ from: 7, counts: { A: 2 } });
    expect(bins[bins.length - 1]).toMatchObject({ from: 12, counts: { B: 1 } });
  });
});

// ─── the open-answers filter ───────────────────────────────────────────────

describe('answerFilters', () => {
  const versions = (config: SurveyConfig): StatsVersion[] => [
    { version: 'v1', published_at: '2026-01-01', config },
  ];

  it('offers every mark and draw by its label, whatever it is named', () => {
    // The regression this guards: the filter used to look up one hardcoded name,
    // `segment`, so a console-built survey offered nothing at all
    const filters = answerFilters(
      versions({
        version: 'v1',
        randomVars: { price: [79, 149] },
        varMeta: {
          mark1: { label: 'פרסונה', values: { v1: 'זוג צעיר', v2: 'בעל משכנתה' } },
          price: { label: 'מחיר' },
        },
        screens: [],
      }),
      'v1',
    );
    expect(filters).toEqual([
      {
        key: 'mark1',
        label: 'פרסונה',
        values: [
          ['v1', 'זוג צעיר'],
          ['v2', 'בעל משכנתה'],
        ],
      },
      { key: 'price', label: 'מחיר', values: [['79', '79'], ['149', '149']] },
    ]);
  });

  it('leaves out anything whose values it cannot list', () => {
    const filters = answerFilters(
      versions({ version: 'v1', varMeta: { mark1: { label: 'בלי ערכים' } }, screens: [] }),
      'v1',
    );
    expect(filters).toEqual([]);
  });
});

// ─── matrix and histogram (ENG-17) ─────────────────────────────────────────

const mxConfig = {
  version: 'm1',
  screens: [
    {
      id: 'trust',
      type: 'matrix' as const,
      prompt: 'עד כמה סומכים?',
      items: [
        { id: 'bank', label: 'הבנק' },
        { id: 'advisor', label: 'יועץ' },
      ],
      scaleMin: 1,
      scaleMax: 5,
      minLabel: 'כלל לא',
      maxLabel: 'מאוד',
      naLabel: 'לא רלוונטי',
    },
    { id: 'budget', type: 'number' as const, prompt: 'תקציב?' },
    { id: 'end', type: 'end' as const, variant: 'complete' as const, title: '', body: '' },
  ],
};
const mxVersions = [{ version: 'm1', published_at: '2026-08-01', config: mxConfig }];
const mxDist = [
  { screen_id: 'trust', item_id: 'bank', answer_key: '4', dim_value: null, n: 1 },
  { screen_id: 'trust', item_id: 'bank', answer_key: '5', dim_value: null, n: 3 },
  { screen_id: 'trust', item_id: 'advisor', answer_key: '2', dim_value: null, n: 2 },
  { screen_id: 'trust', item_id: 'advisor', answer_key: 'na', dim_value: null, n: 1 },
  { screen_id: 'trust', item_id: 'old_item', answer_key: '3', dim_value: null, n: 1 },
  { screen_id: 'budget', item_id: null, answer_key: '400000', dim_value: null, n: 3 },
  { screen_id: 'budget', item_id: null, answer_key: '650000', dim_value: null, n: 1 },
  { screen_id: 'budget', item_id: null, answer_key: '2250000', dim_value: null, n: 2 },
];
const mxFunnel = [
  { screen_id: 'trust', viewed: 6, answered: 5, dropped_here: 0, median_ms: 9000 },
  { screen_id: 'budget', viewed: 6, answered: 6, dropped_here: 0, median_ms: 7000 },
];

describe('questionCards — matrix', () => {
  const matrix = () => questionCards(mxDist, mxFunnel, mxVersions, 'all')[0].matrix!;

  it('shapes per-item counts in config order, appending items that left the config', () => {
    const m = matrix();
    expect(m.scaleMin).toBe(1);
    expect(m.scaleMax).toBe(5);
    expect(m.items.map((i) => [i.id, i.label, i.retiredItem ?? false])).toEqual([
      ['bank', 'הבנק', false],
      ['advisor', 'יועץ', false],
      ['old_item', 'old_item', true],
    ]);
    expect(m.items[0].counts).toEqual({ '4': 1, '5': 3 });
  });

  it('computes the mean over numeric answers only — na is its own count, never averaged', () => {
    const [bank, advisor] = matrix().items;
    expect(bank.mean).toBeCloseTo(4.75); // (4·1 + 5·3) / 4
    expect(bank.n).toBe(4);
    expect(bank.na).toBe(0);
    expect(advisor.mean).toBeCloseTo(2);
    expect(advisor.n).toBe(2);
    expect(advisor.na).toBe(1);
  });

  it('carries the matrix card’s base N from the funnel, like every other card', () => {
    // Every card states how many people answered; a matrix reading its base from
    // its own atom counts would report the item total instead, which for a
    // five-row matrix is five times the number of respondents.
    expect(questionCards(mxDist, mxFunnel, mxVersions, 'all')[0].base).toBe(5);
  });
});

describe('questionCards — number values', () => {
  it('parses numeric atoms sorted ascending', () => {
    const budget = questionCards(mxDist, mxFunnel, mxVersions, 'all')[1];
    expect(budget.numberValues).toEqual([
      { value: 400000, count: 3 },
      { value: 650000, count: 1 },
      { value: 2250000, count: 2 },
    ]);
  });

  it('carries the number card’s base N from the funnel, like every other card', () => {
    expect(questionCards(mxDist, mxFunnel, mxVersions, 'all')[1].base).toBe(6);
  });
});

describe('binNumbers', () => {
  it('picks a clean bin width and aligned edges (hand-computed: span 1.85M → width 500K)', () => {
    const bins = binNumbers(
      [
        { value: 400000, count: 3 },
        { value: 650000, count: 1 },
        { value: 2250000, count: 2 },
      ],
      7,
    );
    expect(bins.map((b) => b.count)).toEqual([3, 1, 0, 0, 2]);
    expect(bins[0]).toMatchObject({ from: 0, to: 500000 });
    expect(bins[4]).toMatchObject({ from: 2000000, to: 2500000 });
  });

  it('handles small integer spans with width 1', () => {
    const bins = binNumbers(
      [
        { value: 7, count: 2 },
        { value: 12, count: 1 },
      ],
      7,
    );
    expect(bins[0]).toMatchObject({ from: 7, to: 8, count: 2 });
    expect(bins[bins.length - 1]).toMatchObject({ from: 12, to: 13, count: 1 });
  });

  it('a single distinct value gets a single bin; no values, no bins', () => {
    expect(binNumbers([{ value: 40, count: 5 }], 7)).toEqual([{ from: 40, to: 41, count: 5 }]);
    expect(binNumbers([], 7)).toEqual([]);
  });
});

describe('orderFunnel', () => {
  it('orders by the latest config when all versions are combined, retired screens greyed at the bottom', () => {
    const rows = orderFunnel(funnelRows, funnelVersions, 'all');
    expect(rows.map((r) => r.screenId)).toEqual(['intro', 'q1', 'q2', 'q_old']);
    expect(rows.map((r) => r.retired)).toEqual([false, false, false, true]);
    // Labels from the config; a retired screen keeps its raw id
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
