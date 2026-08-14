// The statistics screen's pure logic: shaping the API response into display tiles
// and Hebrew formatting. Deliberately free of React and of the network — this is
// the seam that is unit-tested (stats.test.ts).

import type { Screen, SurveyConfig } from '../engine/types';
import type { BaseStat, DistStat, FunnelStat, StatsOverview, StatsVersion } from './api';

export interface OverviewTile {
  key: 'total' | 'completed' | 'screened_out' | 'quota_full' | 'abandoned';
  label: string;
  count: number;
  /** A share of all sessions; null when there is nothing to compute it from (zero sessions, or the total tile) */
  ratio: number | null;
  /** A secondary breakdown — splitting abandonment into its two kinds */
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
      // The order is fixed: first those who never answered at all (a link problem
      // or bots), then mid-survey abandonment (a survey problem) — the central QC
      // distinction in a pilot
      sub: [
        { label: 'נכנסו ולא ענו כלל', count: o.abandoned_bounce },
        { label: 'התחילו לענות ונטשו', count: o.abandoned_mid },
      ],
    },
  ];
}

const nf = new Intl.NumberFormat('he-IL');

export const formatCount = (n: number): string => nf.format(n);

/** A percentage with at most one decimal place: 50% · 16.7% */
export const formatPercent = (ratio: number): string => `${nf.format(Math.round(ratio * 1000) / 10)}%`;

/** Time on screen: seconds below a minute, m:ss above it; null (no answers) → a dash */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${nf.format(totalSec)} שנ׳`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')} דק׳`;
}

// ─── the funnel (ENG-14) ────────────────────────────────────────────────────

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

/** The config that dictates order and labels: the latest under "all versions", or the version selected */
export const chosenConfig = (versions: StatsVersion[], selected: string): SurveyConfig | undefined =>
  (selected === 'all' ? versions[0] : versions.find((v) => v.version === selected))?.config;

/**
 * The funnel's row order is set by a config — the events themselves have no
 * order. Under "all versions" the latest version does the ordering, and screens
 * that exist only in older versions join at the end as "retired", carrying their
 * raw id — a real session never vanishes from the story.
 * A screen nobody reached gets zeros; end screens are not part of the funnel
 * (they are the outcome).
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

// ─── distribution cards (ENG-15/17) ─────────────────────────────────────────

export interface BarGroup {
  key: string | null;
  count: number;
  /** A share of the respondents within the dimension group (the denominator comes from stats_bases) */
  ratio: number | null;
}

export interface ChoiceBar {
  id: string;
  label: string;
  count: number;
  /** A share of those who answered the question (base); on multi-choice the total may exceed 100% */
  ratio: number | null;
  /** An option present in the data but not in the current config — shown with its raw id */
  retiredOption?: boolean;
  /** With a breakdown active: a sub-bar per dimension value, in the legend's order */
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
  /** Counts keyed by rating ('1'..'5'); na is not here */
  counts: Record<string, number>;
  na: number;
  /** How many gave a numeric answer (excluding na) */
  n: number;
  /** The mean of the numeric ratings; null when there is not a single rating */
  mean: number | null;
  /** An item present in the data but not in the current config */
  retiredItem?: boolean;
  /** With a breakdown active: the same computation per dimension value, in the legend's order */
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
  /** How many answered the question (the percentage base) — derived from the funnel data */
  base: number;
  /** The number of versions combined when the answer set differs between them; null = nothing worth noting */
  spansVersions: number | null;
  /** single/multi only */
  bars?: ChoiceBar[];
  /** matrix only */
  matrix?: MatrixCardModel;
  /** number only: sorted numeric values — the binning happens in the histogram */
  numberValues?: { value: number; count: number }[];
  /** The screen's raw atoms */
  atoms: DistStat[];
}

const CLOSED_TYPES = new Set<Screen['type']>(['single', 'multi', 'matrix', 'number']);

/** The identity of a question's answer set in a version — compared across versions for the "spans N versions" note */
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
 * A card model per closed question, in the order of the governing config. Labels
 * come from the config; a key present in the data but not in the config (an
 * option that was removed) joins at the end with its raw id.
 * Open questions (text) are deliberately not here — they are shown verbatim in
 * their own tab, with no content analysis at all. consent/info belong to the
 * funnel, not to the distributions.
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
  // base = "answered" from the funnel (sessions with any answer event). For closed
  // questions that equals, by definition, the number of final answers that are not
  // null — a null answer only exists on text questions (a deliberate skip), and
  // those have no card. The breakdown denominators (stats_bases) count non-null
  // final answers — exactly the same number for the screens drawn here.
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
      // With a breakdown active there is a row per (key, dimension) — the summing happens here, rather than assuming one row per key
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
        // An unambiguous composite key — option ids and dimension values may contain any character
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
      // Summing per value — under a breakdown the same value arrives in a row per dimension
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

// ─── breakdowns (ENG-18) ────────────────────────────────────────────────────

export interface DimensionOption {
  key: string;
  label: string;
}

/**
 * The dimensions offered for a breakdown: varMeta variables (by their labels),
 * randomVars variables (experiment arms), the arrival source url_source, and the
 * session outcome. Deliberately not every url_* (panel ids = one value per
 * person's worth of cardinality).
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

/** A dimension value in the legend: key=null is "unknown" (a session with no value for the dimension) */
export interface DimValue {
  key: string | null;
  label: string;
  color: string;
}

export interface DimensionLegend {
  /** refused = more than 12 values — there is no honest way to draw that */
  mode: 'ok' | 'refused';
  values: DimValue[];
  distinct: number;
}

/**
 * The series palette: the dataviz skill's fixed hue order (validated for colour
 * vision deficiency *in that order* — the order is the safety mechanism, not
 * cosmetics). The colour is bound to the value's identity, not to its frequency.
 * Grey is reserved for "unknown" and is not part of the series.
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

/** A Hebrew label for a session outcome on a single answer row (abandoned = any abandonment) */
export const outcomeLabel = (outcome: string): string =>
  outcome === 'abandoned' ? 'נטישה' : (OUTCOME_LABELS[outcome] ?? outcome);

/** The governing config's text questions — the list the open-answers tab pages through */
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
  // "Unknown" is a bar in the chart like any other — it counts towards the ceiling alongside the known values
  const distinct = present.size + (hasUnknown ? 1 : 0);
  if (distinct > MAX_DIMENSION_VALUES) {
    return { mode: 'refused', values: [], distinct };
  }

  // A stable order that does not depend on frequency: the declared order (varMeta
  // / the fixed outcome order), and undeclared values lexicographically. That way
  // a filter never "recolours" the groups.
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

// ─── the histogram (ENG-17) ─────────────────────────────────────────────────

export interface NumberBin {
  from: number;
  to: number;
  count: number;
}

/** A "clean" bucket width: 1/2/5 × 10^k — the nearest one at or above the raw width */
function niceWidth(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / pow;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Bucketing values on round boundaries: the width is chosen so the bucket count
 * is ≤ target, and the edges are aligned to multiples of the width — "0–500,000"
 * and not "400,123–723,456".
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

/** The dimension key for the histogram counts: null (unknown) gets a reserved key */
export const UNKNOWN_DIM_KEY = '__unknown__';

export interface NumberBinByDim {
  from: number;
  to: number;
  /** A count per dimension value; the key for an unknown value is UNKNOWN_DIM_KEY */
  counts: Record<string, number>;
}

/** A broken-down histogram: the same buckets for every group (comparing groups requires identical axes) */
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
