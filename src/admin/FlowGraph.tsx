// The flow diagram — the survey's primary editing surface.
// Interactions (inspired by Typeform's Logic Map / n8n):
//   click a node            → select it and open the editing drawer
//   double-click the text   → edit the question's wording in place
//   drag a node             → change its position in the sequence (the layout is
//                              recomputed — the diagram never lies: the position
//                              always reflects the real flow order)
//   drag from the port      → create a routing rule (goto) to the target node + a
//                              condition popover
//   click an edge label     → edit that edge's condition (a goto rule or the
//                              target's showIf)
//   hover an edge → +       → insert a screen inside that transition
//   hover a node            → a small action bar: duplicate, delete

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Condition, Screen, SurveyConfig } from '../engine/types';
import { validateConfig, type ValidationIssue } from '../engine/validate';
import { buildFlow, describeCondition } from './graph';
import { duplicateScreen, uniqueId } from './edits';
import { laneMembers } from './lanes';
import { OptionalCondition } from './ConditionBuilder';
import type { Naming } from './display';
import { screenRef } from './display';
import { TYPE_LABELS } from './labels';
import { CloseIcon, CopyIcon, PlusIcon, StopIcon, TrashIcon, TypeIcon } from './Icons';

const NODE_W = 236;
const NODE_H = 74;
const END_H = 52;
const DRAG_THRESHOLD = 8;

interface Point {
  x: number;
  y: number;
}

interface LaidOutNode {
  id: string;
  arrayIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  type: Screen['type'];
}

interface LaidOutEdge {
  from: string;
  to: string;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  conditional: boolean;
  kind: 'goto' | 'primary' | 'skip' | 'quota';
  ruleIndex?: number;
  /** A structural edge: entering a lane / a merge between adjacent rows — its label is always shown */
  structural?: boolean;
  /** An edge that carries no information (a skip/a duplicate/an end sign) — drawn only when one of its ends is selected */
  quiet?: boolean;
  /** The direction of the line segment the label sits on — it may only be shifted along it */
  labelAxis?: 'h' | 'v';
}

/**
 * An end sign (an "off-page connector") — instead of a line crossing the whole
 * canvas to a distant end screen, the node gets a small badge. The real line is
 * drawn only when the node is selected.
 */
interface LaidOutStub {
  sourceId: string;
  targetId: string;
  label: string;
  variant: Extract<Screen, { type: 'end' }>['variant'];
  ruleIndex?: number;
  x: number;
  y: number;
}

const EPS = 0.5;
const CORNER_R = 6;

/** An orthogonal route (straight lines, square corners) from dagre's routing points */
function orthogonalPath(pts: Point[]): string {
  if (pts.length < 2) return '';
  const steps: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = steps[steps.length - 1];
    const cur = pts[i];
    if (Math.abs(cur.x - prev.x) > EPS && Math.abs(cur.y - prev.y) > EPS) {
      steps.push({ x: prev.x, y: cur.y });
    }
    steps.push(cur);
  }
  const clean: Point[] = [];
  for (const p of steps) {
    const last = clean[clean.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    if (clean.length >= 2) {
      const a = clean[clean.length - 2];
      const collinear =
        (Math.abs(a.x - last.x) < EPS && Math.abs(last.x - p.x) < EPS) ||
        (Math.abs(a.y - last.y) < EPS && Math.abs(last.y - p.y) < EPS);
      if (collinear) clean.pop();
    }
    clean.push(p);
  }
  if (clean.length < 2) return '';
  let d = `M${clean[0].x},${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    const next = clean[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(CORNER_R, inLen / 2, outLen / 2);
    const ix = cur.x - ((cur.x - prev.x) / (inLen || 1)) * r;
    const iy = cur.y - ((cur.y - prev.y) / (inLen || 1)) * r;
    const ox = cur.x + ((next.x - cur.x) / (outLen || 1)) * r;
    const oy = cur.y + ((next.y - cur.y) / (outLen || 1)) * r;
    d += `L${ix},${iy}Q${cur.x},${cur.y} ${ox},${oy}`;
  }
  const end = clean[clean.length - 1];
  return `${d}L${end.x},${end.y}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A comfortable floor for manual zoom — we go below it only when the diagram would not fit otherwise. */
const COMFORT_MIN_ZOOM = 0.25;
/** A hard floor: below it nothing is legible in any case. */
const ABS_MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;
/** A minimal margin above the diagram when it is taller than the canvas. */
const FIT_PADDING = 16;

/** Jumping to a node: below this zoom it cannot be read, so we zoom in to it */
const FOCUS_MIN_ZOOM = 0.7;
/** Longer than the panels' transition (0.32s), so the final frame lands on a layout that has settled */
const FOCUS_MS = 420;

/** The margin between the floating popover and the canvas edge, and its distance from its anchor */
const POPOVER_PAD = 12;
const POPOVER_GAP = 14;

// Exceptionally long condition labels are still truncated — the full wording
// stays in the tooltip and in the condition editor — but the limit is generous:
// most labels ("I am not involved in my household's mortgage decisions") fit
// whole, and the box grows with the text.
const LABEL_MAX_CHARS = 46;
const LABEL_H = 18;
const shortLabel = (t: string) => (t.length > LABEL_MAX_CHARS ? `${t.slice(0, LABEL_MAX_CHARS - 1)}…` : t);
const labelWidth = (t: string) => Math.min(310, shortLabel(t).length * 6.4 + 18);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxesHit = (a: Box, b: Box, pad = 11) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// Offsets for a colliding label, nearest first — always along the line the label
// sits on, otherwise the label detaches from its line and looks "suspended in
// mid-air"
const LABEL_NUDGES_V: Array<[number, number]> = [0, -17, 17, -34, 34, -51, 51, -68, 68].map((dy) => [0, dy]);
const LABEL_NUDGES_H: Array<[number, number]> = [0, -40, 40, -80, 80, -120, 120].map((dx) => [dx, 0]);

/** Every id (questions and variables) a condition depends on */
const condRefs = (c: Condition): string[] =>
  'all' in c ? c.all.flatMap(condRefs)
  : 'any' in c ? c.any.flatMap(condRefs)
  : 'not' in c ? condRefs(c.not)
  : ['q' in c ? c.q : c.var];

function nodeMainText(screen: Screen): { value: string; field: 'title' | 'prompt' } {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return { value: screen.title, field: 'title' };
    default:
      return { value: screen.prompt, field: 'prompt' };
  }
}

function newScreenOfType(type: Screen['type'], id: string): Screen {
  switch (type) {
    case 'info':
      return { id, type, title: '', body: '' };
    case 'consent':
      return { id, type, title: '', body: '', agreeLabel: 'אני מסכים/ה', declineLabel: 'לא מעוניין/ת' };
    case 'single':
    case 'multi':
      return { id, type, prompt: '', options: [{ id: 'opt_1', label: '' }] };
    case 'matrix':
      return {
        id, type, prompt: '', items: [{ id: 'item_1', label: '' }],
        scaleMin: 1, scaleMax: 5, minLabel: '', maxLabel: '',
      };
    case 'number':
      return { id, type, prompt: '' };
    case 'text':
      return { id, type, prompt: '' };
    case 'end':
      return { id, type, variant: 'complete', title: '', body: '' };
  }
}

type DragState =
  | { mode: 'maybe'; kind: 'reorder' | 'connect'; id: string; startX: number; startY: number }
  | { mode: 'reorder'; id: string; dx: number; dy: number; insertAt: number | null; indicatorY: number; indicatorX: number; indicatorW: number }
  | { mode: 'connect'; id: string; toX: number; toY: number; targetId: string | null; targetBlocked: boolean };

type Popover =
  | { kind: 'rule'; screenId: string; ruleIndex: number }
  | { kind: 'showIf'; screenId: string }
  | { kind: 'insert'; fromId: string; toId: string; edgeKind: 'goto' | 'primary'; ruleIndex?: number; x: number; y: number }
  | { kind: 'append'; x: number; y: number }
  | { kind: 'edgeMenu'; edgeIndex: number; x: number; y: number };

/** Adds a goto rule from a screen to a target — before the unconditional rule if there is one (so it is not dead code) */
function withConnection(cfg: SurveyConfig, sourceId: string, targetId: string): { cfg: SurveyConfig; at: number } | null {
  const source = cfg.screens.find((s) => s.id === sourceId);
  if (!source || source.type === 'end') return null;
  const rules = source.next ?? [];
  const uncondIdx = rules.findIndex((r) => !r.if);
  const at = uncondIdx === -1 ? rules.length : uncondIdx;
  return {
    cfg: {
      ...cfg,
      screens: cfg.screens.map((s) =>
        s.id === sourceId
          ? ({ ...s, next: [...rules.slice(0, at), { goto: targetId }, ...rules.slice(at)] } as Screen)
          : s,
      ),
    },
    at,
  };
}

interface Props {
  config: SurveyConfig;
  issues: ValidationIssue[];
  selectedId: string | null;
  naming: Naming;
  /** The path-check route, in order — null when the run is off */
  simPath: string[] | null;
  /** A request from one of the panels to bring a node to the centre of the screen; the counter allows the same request again */
  focusRequest: { id: string; nonce: number } | null;
  onSelect: (id: string | null) => void;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
}

export function FlowGraph({ config, issues, selectedId, naming, simPath, focusRequest, onSelect, onUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  /** The manual zoom floor; it drops below COMFORT_MIN_ZOOM when the fit is forced under it */
  const minZoom = useRef(COMFORT_MIN_ZOOM);
  /** Whether the editor panned or zoomed the view themselves — if so we do not refit under their hands */
  const userMoved = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "take me to this node" animation. The current view is kept in a ref
  // because the animation starts from inside an effect, and any touch of the view
  // by the editor (a pan, the wheel) cancels it immediately.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const focusAnim = useRef<number | null>(null);
  const cancelFocusAnim = useCallback(() => {
    if (focusAnim.current !== null) cancelAnimationFrame(focusAnim.current);
    focusAnim.current = null;
  }, []);
  useEffect(() => cancelFocusAnim, [cancelFocusAnim]);

  const errorIds = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.screenId).map((i) => i.screenId!)),
    [issues],
  );

  // --- detecting "what changed" — the nodes the last edit touched get a flash ---
  // The config is immutable: a screen that changed gets a new reference, so a
  // reference comparison identifies exactly the screens that were edited or added.
  // A pure reorder does not replace any reference — it is detected separately, by
  // finding the screen that was pulled out of the sequence.
  const prevConfigRef = useRef(config);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const prev = prevConfigRef.current;
    prevConfigRef.current = config;
    if (prev === config) return;
    const prevById = new Map(prev.screens.map((s) => [s.id, s]));
    const ids = new Set<string>();
    for (const s of config.screens) {
      const p = prevById.get(s.id);
      if (!p || p !== s) ids.add(s.id);
    }
    if (ids.size === 0) {
      const oldIds = prev.screens.map((s) => s.id);
      const newIds = config.screens.map((s) => s.id);
      if (oldIds.join('\n') !== newIds.join('\n')) {
        const moved = newIds.find(
          (x) => oldIds.filter((i) => i !== x).join('\n') === newIds.filter((i) => i !== x).join('\n'),
        );
        if (moved) ids.add(moved);
        else newIds.forEach((id, i) => oldIds[i] !== id && ids.add(id));
      }
    }
    if (ids.size === 0) return;
    setChangedIds(ids);
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => setChangedIds(new Set()), 1800);
  }, [config]);

  // A deterministic "track tree" layout: a run of screens sharing a showIf forms a
  // lane column, and different conditions in one run sit side by side — like a
  // journey map in FigJam. The position depends solely on the array order and on
  // the grouping of showIf conditions (not on the edges!) — which is why
  // connecting two nodes moves no node at all, and an edit only moves the rows
  // below it.
  const layout = useMemo(() => {
    const MARGIN = 40;
    // The corridor between rows holds both the horizontal lines and the condition
    // labels — too narrow and the labels pile up on each other and on the nodes
    const V_GAP = 96;
    const INNER_GAP = 30; // between screens within one lane
    const COL_W = NODE_W + 60; // a column's width, including the gap between lanes
    const LANE_GAP = 30; // the distance of the first track from the columns
    const LANE_W = 28; // the gap between tracks

    const flow = buildFlow(config);
    const screens = config.screens;

    // Rows: a screen with no showIf = a spine row; a run of showIf screens = a lane
    // row. A lane = consecutive screens with the same condition (compared as JSON),
    // stacked vertically.
    interface Row {
      branches: number[][];
      top: number;
      bottom: number;
    }
    const rows: Row[] = [];
    for (let i = 0; i < screens.length; ) {
      if (!screens[i].showIf) {
        rows.push({ branches: [[i]], top: 0, bottom: 0 });
        i++;
        continue;
      }
      let branches: number[][] = [];
      let key: string | null = null;
      // What has already been "produced" in the current row (screens and onSubmit
      // variables) — a lane whose condition depends on that has to drop a row: the
      // flow passes through what is above it
      const produced = new Set<string>();
      while (i < screens.length && screens[i].showIf) {
        const s = screens[i];
        const k = JSON.stringify(s.showIf);
        if (k !== key) {
          if (branches.length > 0 && condRefs(s.showIf!).some((r) => produced.has(r))) {
            rows.push({ branches, top: 0, bottom: 0 });
            branches = [];
            produced.clear();
          }
          branches.push([]);
          key = k;
        }
        branches[branches.length - 1].push(i);
        produced.add(s.id);
        for (const rule of s.onSubmit ?? []) produced.add(rule.var);
        i++;
      }
      rows.push({ branches, top: 0, bottom: 0 });
    }

    // The spine down the middle; a lane row spreads symmetrically around it, the first lane on the right
    const maxHalf = rows.reduce((m, r) => Math.max(m, ((r.branches.length - 1) / 2) * COL_W), 0);
    const spineX = MARGIN + maxHalf;

    const nodes: LaidOutNode[] = new Array(screens.length);
    const lanes: { ids: string[]; x: number; y: number }[] = [];
    const rowOf = new Map<string, number>();
    const headIds = new Set<string>(); // a column head — the entry from above is free
    const tailIds = new Set<string>(); // a column tail — the exit below is free
    let y = MARGIN;
    rows.forEach((row, ri) => {
      row.top = y;
      const n = row.branches.length;
      let rowBottom = y;
      row.branches.forEach((br, bi) => {
        const x = spineX + ((n - 1) / 2 - bi) * COL_W;
        // A lane = several screens sharing exactly the same display condition. This
        // is the group the admin thinks of as a "track", which makes it the unit of
        // editing too — one condition for all of them.
        if (br.length > 1 && screens[br[0]].showIf) {
          lanes.push({ ids: br.map((idx) => screens[idx].id), x, y });
        }
        let by = y;
        br.forEach((idx, j) => {
          const s = screens[idx];
          const h = s.type === 'end' ? END_H : NODE_H;
          nodes[idx] = { id: s.id, arrayIndex: idx, x, y: by, w: NODE_W, h, text: flow.nodes[idx].text, type: s.type };
          rowOf.set(s.id, ri);
          if (j === 0) headIds.add(s.id);
          if (j === br.length - 1) tailIds.add(s.id);
          by += h + INNER_GAP;
        });
        rowBottom = Math.max(rowBottom, by - INNER_GAP);
      });
      row.bottom = rowBottom;
      y = rowBottom + V_GAP;
    });
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));

    // Bay g = the horizontal gap above row g (g === rows.length: below the last
    // one). Each source gets its own height within it — different horizontal lines
    // never coincide; one source shares a single height, so a fork looks like one
    // trunk splitting.
    const gapSlots = new Map<number, Map<string, number>>();
    const gapBase = (g: number) =>
      g < rows.length ? rows[g].top - V_GAP / 2 : rows[rows.length - 1].bottom + V_GAP / 2;
    const gapY = (g: number, key: string) => {
      let m = gapSlots.get(g);
      if (!m) gapSlots.set(g, (m = new Map()));
      if (!m.has(key)) m.set(key, m.size);
      const slot = m.get(key)!;
      const off = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 13;
      return clamp(gapBase(g) + off, gapBase(g) - V_GAP / 2 + 10, gapBase(g) + V_GAP / 2 - 10);
    };

    const mkEdge = (
      e: (typeof flow.edges)[number],
      pts: Point[],
      labelX: number,
      labelY: number,
      label: string,
      structural = false,
      quiet = false,
      labelAxis: 'h' | 'v' = 'v',
    ): LaidOutEdge => ({
      from: e.from,
      to: e.to,
      path: orthogonalPath(pts),
      label,
      labelX,
      labelY,
      conditional: e.conditional,
      kind: e.kind,
      ruleIndex: e.ruleIndex,
      structural,
      quiet,
      labelAxis,
    });

    // Edges that cannot be routed through the adjacent bays detour along a vertical track to the right of the columns
    interface LaneEdge {
      e: (typeof flow.edges)[number];
      exitPts: Point[];
      exitY: number;
      entryPts: Point[];
      entryY: number;
      minY: number;
      maxY: number;
      lane: number;
    }
    const edges: LaidOutEdge[] = [];
    const laneEdges: LaneEdge[] = [];
    const stubs: LaidOutStub[] = [];
    const stubCount = new Map<string, number>();
    const quietCount = new Map<string, number>();
    let maxQuietX = 0;

    // Lane heads that receive a fork from the row above them: their entry is
    // already told there, so an "if not lane A then lane B" chain between
    // neighbouring lanes is a duplicate — and is silenced
    const forked = new Set<string>();
    for (const e of flow.edges) {
      const rs = rowOf.get(e.from);
      const rt = rowOf.get(e.to);
      if (rt === undefined || rs === undefined) continue;
      if (rt === rs + 1 && tailIds.has(e.from) && headIds.has(e.to)) forked.add(e.to);
    }

    flow.edges.forEach((e, i) => {
      const s = byId.get(e.from);
      const t = byId.get(e.to);
      if (!s || !t) return;
      const rs = rowOf.get(e.from)!;
      const rt = rowOf.get(e.to)!;
      const scx = s.x + s.w / 2;
      const tcx = t.x + t.w / 2;

      // A direct continuation within a lane — with no label (the condition is already written on the lane's entry)
      if (rs === rt && s.x === t.x && Math.abs(t.y - (s.y + s.h + INNER_GAP)) < 1) {
        edges.push(mkEdge(e, [{ x: scx, y: s.y + s.h }, { x: tcx, y: t.y }], scx, (s.y + s.h + t.y) / 2, ''));
        return;
      }

      // A fork or a merge between adjacent rows — through the bay above the target's row
      if (rt === rs + 1 && tailIds.has(s.id) && headIds.has(t.id)) {
        const yMid = gapY(rt, 'out:' + e.from);
        const straight = Math.abs(scx - tcx) < 1;
        edges.push(
          mkEdge(
            e,
            [{ x: scx, y: s.y + s.h }, { x: scx, y: yMid }, { x: tcx, y: yMid }, { x: tcx, y: t.y }],
            straight ? scx : (scx + tcx) / 2,
            straight ? (s.y + s.h + t.y) / 2 : yMid,
            e.label,
            true,
            false,
            straight ? 'v' : 'h',
          ),
        );
        return;
      }

      // Between neighbouring lanes in the same row — above the row, when both heads are free
      if (rs === rt && s.x !== t.x && headIds.has(s.id) && headIds.has(t.id)) {
        const yMid = gapY(rs, 'top:' + e.from);
        edges.push(
          mkEdge(
            e,
            [{ x: scx, y: s.y }, { x: scx, y: yMid }, { x: tcx, y: yMid }, { x: tcx, y: t.y }],
            (scx + tcx) / 2,
            yMid,
            e.label,
            !forked.has(e.to),
            forked.has(e.to),
            'h',
          ),
        );
        return;
      }

      // Explicit routing to a distant end screen: the line would cross the whole
      // canvas without adding any information ("the interview ends here"). In its
      // place, a small sign on the node — the line itself is kept and drawn only
      // when the node is selected, so no path ever really disappears.
      const isEndStub = (e.kind === 'goto' || e.kind === 'quota') && t.type === 'end';
      if (isEndStub) {
        const k = stubCount.get(e.from) ?? 0;
        stubCount.set(e.from, k + 1);
        const target = screens[t.arrayIndex];
        stubs.push({
          sourceId: e.from,
          targetId: e.to,
          label: e.label,
          variant: target.type === 'end' ? target.variant : 'complete',
          ruleIndex: e.ruleIndex,
          x: s.x,
          y: s.y + s.h + 6 + k * 24,
        });
      }

      // A quiet edge (a skip / an end sign) — shown only when one of its ends is
      // selected. It gets no track of its own: a real survey has thousands of
      // skips, and a track for each would widen the canvas tenfold and reveal
      // clipped lines. Instead — a direct route through the gutter beside the
      // column: short, always inside the canvas, and over a layer that is dimmed
      // anyway.
      if (isEndStub || e.kind === 'skip') {
        // Each quiet edge from the same source gets its own gutter, otherwise all
        // the paths revealed by a selection crowd into one thick line and not one of
        // them can be followed
        const q = quietCount.get(e.from) ?? 0;
        quietCount.set(e.from, q + 1);
        const gx = Math.max(s.x + s.w, t.x + t.w) + 16 + q * 20;
        maxQuietX = Math.max(maxQuietX, gx);
        const sy = s.y + s.h / 2;
        const ty = t.y + t.h / 2;
        edges.push(
          mkEdge(
            e,
            [{ x: s.x + s.w, y: sy }, { x: gx, y: sy }, { x: gx, y: ty }, { x: t.x + t.w, y: ty }],
            gx,
            (sy + ty) / 2,
            e.label,
            false,
            true,
          ),
        );
        return;
      }

      // A side track: exiting from below (a tail) or from the node's side (mid-lane),
      // entering from above (a head) or from the side — always through the bays, so
      // the line crosses no node
      const exit = tailIds.has(s.id)
        ? (() => {
            const yOut = gapY(rs + 1, 'out:' + e.from);
            return { pts: [{ x: scx, y: s.y + s.h }, { x: scx, y: yOut }], y: yOut };
          })()
        : { pts: [{ x: s.x + s.w, y: s.y + s.h / 2 }], y: s.y + s.h / 2 };
      const entry = headIds.has(t.id)
        ? (() => {
            const yIn = gapY(rt, 'in:' + i);
            return { pts: [{ x: tcx, y: yIn }, { x: tcx, y: t.y }], y: yIn };
          })()
        : { pts: [{ x: t.x + t.w, y: t.y + t.h / 2 }], y: t.y + t.h / 2 };
      laneEdges.push({
        e,
        exitPts: exit.pts,
        exitY: exit.y,
        entryPts: entry.pts,
        entryY: entry.y,
        minY: Math.min(exit.y, entry.y),
        maxY: Math.max(exit.y, entry.y),
        lane: 0,
      });
    });

    // Track allocation by interval colouring, short before long — for always-visible edges only
    const laneEnds: { minY: number; maxY: number }[][] = [];
    laneEdges.sort((a, b) => a.maxY - a.minY - (b.maxY - b.minY));
    for (const se of laneEdges) {
      let lane = 0;
      for (; lane < laneEnds.length; lane++) {
        if (laneEnds[lane].every((iv) => se.maxY < iv.minY - 6 || se.minY > iv.maxY + 6)) break;
      }
      (laneEnds[lane] ??= []).push({ minY: se.minY, maxY: se.maxY });
      se.lane = lane;
    }

    const colsRight = spineX + NODE_W + maxHalf;
    for (const se of laneEdges) {
      const lx = colsRight + LANE_GAP + se.lane * LANE_W;
      edges.push(
        mkEdge(
          se.e,
          [...se.exitPts, { x: lx, y: se.exitY }, { x: lx, y: se.entryY }, ...se.entryPts],
          lx,
          (se.exitY + se.entryY) / 2,
          se.e.label,
        ),
      );
    }

    // Spreading the labels out: no label rests on a node, on an end sign or on
    // another label. They are shifted along one axis only (so a label stays on its
    // own line) and in a fixed order — the layout stays deterministic, and the
    // nodes do not move at all.
    const occupied: Box[] = [
      ...nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
      ...stubs.map((st) => ({ x: st.x, y: st.y, w: labelWidth(st.label) + 60, h: 20 })),
    ];
    const labelBox = (e: LaidOutEdge, dx = 0, dy = 0): Box => {
      const w = labelWidth(e.label);
      return { x: e.labelX + dx - w / 2, y: e.labelY + dy - LABEL_H / 2, w, h: LABEL_H };
    };
    // Only always-visible edges take part. A quiet edge is revealed on its own by
    // a selection and has a gutter to itself — moving it would only detach its
    // label from its line ("suspended in mid-air").
    const labelled = edges.filter((e) => e.label && !e.quiet).sort((a, b) => a.labelY - b.labelY || a.labelX - b.labelX);
    for (const e of labelled) {
      // We move it only along the line the label sits on — that is what keeps it attached to it
      const nudges = e.labelAxis === 'h' ? LABEL_NUDGES_H : LABEL_NUDGES_V;
      const spot = nudges.find(([dx, dy]) => !occupied.some((o) => boxesHit(labelBox(e, dx, dy), o)));
      if (spot) {
        e.labelX += spot[0];
        e.labelY += spot[1];
        occupied.push(labelBox(e));
      } else {
        // No free space: an identical label nearby already says the same thing — so
        // we drop it (the line itself stays, with the full condition in the tooltip
        // and in the right-click menu)
        e.label = '';
      }
    }


    return {
      nodes,
      edges,
      stubs,
      lanes,
      width: Math.max(colsRight + LANE_GAP + laneEnds.length * LANE_W + 60, maxQuietX + 40) + MARGIN,
      height: y - V_GAP + MARGIN,
    };
  }, [config]);

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  /** A screen id → every screen sharing its display condition in an unbroken run. */
  const laneOf = useCallback((id: string) => laneMembers(config.screens, id), [config.screens]);

  // Focus: selecting a screen highlights it and its immediate neighbours and dims
  // the rest — you read one story at a time instead of the whole map at once.
  const focusIds = useMemo(() => {
    if (!selectedId || !nodeById.has(selectedId)) return null;
    const ids = new Set([selectedId]);
    for (const e of layout.edges) {
      if (e.from === selectedId) ids.add(e.to);
      if (e.to === selectedId) ids.add(e.from);
    }
    for (const st of layout.stubs) if (st.sourceId === selectedId) ids.add(st.targetId);
    return ids;
  }, [selectedId, layout, nodeById]);

  // The path check: the route this respondent will actually walk. It takes
  // precedence over the selection focus — when the admin is running answers, the
  // story is the path and not the selected screen's neighbours.
  const pathSet = useMemo(() => (simPath ? new Set(simPath) : null), [simPath]);
  const pathEdges = useMemo(() => {
    if (!simPath) return null;
    const set = new Set<string>();
    for (let i = 0; i + 1 < simPath.length; i++) set.add(`${simPath[i]}→${simPath[i + 1]}`);
    return set;
  }, [simPath]);

  // An end screen whose every entry turned into a sign would look disconnected — a
  // counter badge gives it its context back: how many paths end there, and from
  // where
  const inboundStubs = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const st of layout.stubs) m.set(st.targetId, [...(m.get(st.targetId) ?? []), st.sourceId]);
    return m;
  }, [layout]);

  // A geometry signature: when the layout moves, the edge layer cross-fades (the
  // nodes glide into place in CSS; SVG lines cannot be animated reliably — so we
  // fade instead)
  const geomSig = useMemo(
    () =>
      layout.nodes.map((n) => `${n.id}:${Math.round(n.x)},${Math.round(n.y)}`).join('|') +
      '#' +
      layout.edges.length,
    [layout],
  );

  /**
   * "Fit to screen".
   *
   * The zoom floor used to be fixed at 0.25, and with 70 real screens the fit
   * stopped there: the diagram came out nearly twice as tall as the canvas, the
   * effective text dropped to 3px, and only 47 nodes were visible. The floor now
   * goes as low as it needs to for the diagram to fit, and the diagram is centred
   * vertically too rather than pinned to the top.
   */
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.width === 0 || layout.height === 0) return;
    cancelFocusAnim();
    const k = clamp(
      Math.min((el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height),
      ABS_MIN_ZOOM,
      1,
    );
    // The manual zoom floor drops along with the fit, otherwise a single wheel
    // notch would snap the diagram back to 0.25 and undo it
    minZoom.current = Math.min(COMFORT_MIN_ZOOM, k);
    setView({
      x: (el.clientWidth - layout.width * k) / 2,
      y: Math.max(FIT_PADDING, (el.clientHeight - layout.height * k) / 2),
      k,
    });
    userMoved.current = false;
  }, [layout.width, layout.height, cancelFocusAnim]);

  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current) {
      didFit.current = true;
      fit();
    }
  }, [fit]);

  /**
   * Bringing a node to the centre of the canvas. The target is recomputed every
   * frame rather than once at the start: the click that calls this also opens the
   * editing drawer, and the canvas shrinks while the animation runs — a single
   * computation would land half a drawer off centre.
   */
  const focusNode = useCallback(
    (id: string) => {
      const el = containerRef.current;
      const n = nodeById.get(id);
      if (!el || !n) return;
      cancelFocusAnim();
      // From here on the view "belongs to the editor" — the automatic fit will not override it
      userMoved.current = true;
      const from = viewRef.current;
      const toK = clamp(Math.max(from.k, FOCUS_MIN_ZOOM), minZoom.current, MAX_ZOOM);
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / FOCUS_MS);
        const e = 1 - Math.pow(1 - p, 3);
        const k = from.k + (toK - from.k) * e;
        const tx = el.clientWidth / 2 - cx * k;
        const ty = el.clientHeight / 2 - cy * k;
        setView({ k, x: from.x + (tx - from.x) * e, y: from.y + (ty - from.y) * e });
        focusAnim.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      focusAnim.current = requestAnimationFrame(step);
    },
    [nodeById, cancelFocusAnim],
  );

  // The counter and not just the id: without it every layout change (which
  // replaces focusNode) would snap the view back to the last request
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastFocus.current) return;
    lastFocus.current = focusRequest.nonce;
    focusNode(focusRequest.id);
  }, [focusRequest, focusNode]);

  // Resizing the window, opening or closing the drawer and hiding the screen list
  // all change the canvas width without touching the view — the diagram would stay
  // in the wrong place until "fit to screen" was clicked by hand. We refit only
  // for as long as the editor has not moved the view themselves.
  //
  // ⚠ Only a *real* change in the canvas size. ResizeObserver also fires at the
  // moment of attachment, and the attachment recurs on every edit that changes the
  // diagram's dimensions (fit depends on them) — without this comparison every
  // insertion, deletion or reorder would re-centre the view, which is exactly what
  // the stable layout exists to prevent.
  const lastSize = useRef<{ w: number; h: number } | null>(null);
  // The canvas dimensions are also needed by the floating popover, which clamps itself to them so as not to leave the screen
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCanvasSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
      const previous = lastSize.current;
      lastSize.current = { w: width, h: height };
      if (!previous || (previous.w === width && previous.h === height)) return;
      if (!userMoved.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  // The floating popover's dimensions — measured and not estimated: its height
  // varies with the content (an expanded condition builder, a new-screen form),
  // and without them it cannot be clamped to the canvas bounds
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popSize, setPopSize] = useState({ w: 340, h: 0 });
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setPopSize((s) =>
        Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [popover]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // The wheel inside the floating popover scrolls its content rather than moving the diagram
      if ((e.target as HTMLElement).closest('.fg-popover')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      cancelFocusAnim();
      userMoved.current = true;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), minZoom.current, MAX_ZOOM);
        const ratio = k / v.k;
        return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cancelFocusAnim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null);
        setEditingId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = containerRef.current!.getBoundingClientRect();
      return { x: (e.clientX - rect.left - view.x) / view.k, y: (e.clientY - rect.top - view.y) / view.k };
    },
    [view],
  );

  /* ---------- panning ---------- */

  const panRef = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);

  function startPan(e: React.PointerEvent) {
    // Panning on the left button only — capturing the pointer on a right-click
    // diverts the contextmenu event from the edge to the canvas, and the edge's
    // menu never opens
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.fg-node-wrap, .fg-popover, .fg-toolbar, .fg-edge-label, .fg-insert-btn, .fg-stub')) return;
    cancelFocusAnim();
    setPopover(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y, moved: false };
  }

  function movePan(e: React.PointerEvent) {
    const p = panRef.current;
    if (!p) return;
    if (Math.hypot(e.clientX - p.px, e.clientY - p.py) > DRAG_THRESHOLD) {
      p.moved = true;
      userMoved.current = true;
    }
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.px), y: p.vy + (e.clientY - p.py) }));
  }

  function endPan(e: React.PointerEvent) {
    // A click on empty background (with no drag) clears the selection and leaves focus mode
    if (panRef.current && !panRef.current.moved) onSelect(null);
    panRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  /* ---------- dragging a node: reordering / connecting ---------- */

  function nodePointerDown(e: React.PointerEvent, id: string, kind: 'reorder' | 'connect') {
    if (e.button !== 0) return;
    e.stopPropagation();
    // A drag while the view is still moving — the target marker would trail a view sliding out from under it
    cancelFocusAnim();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode: 'maybe', kind, id, startX: e.clientX, startY: e.clientY });
  }

  function computeInsert(world: Point, draggedId: string): { insertAt: number; indicatorY: number; indicatorX: number; indicatorW: number } | null {
    const candidates = layout.nodes.filter((n) => n.id !== draggedId);
    if (candidates.length === 0) return null;
    let best: LaidOutNode | null = null;
    let bestDist = Infinity;
    for (const n of candidates) {
      const cx = n.x + n.w / 2;
      const cy = n.y + n.h / 2;
      const dist = Math.hypot((world.x - cx) * 0.35, world.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    if (!best) return null;
    const before = world.y < best.y + best.h / 2;
    const draggedIdx = config.screens.findIndex((s) => s.id === draggedId);
    let insertAt = before ? best.arrayIndex : best.arrayIndex + 1;
    if (draggedIdx < insertAt) insertAt--;
    return {
      insertAt,
      indicatorY: before ? best.y - 8 : best.y + best.h + 8,
      indicatorX: best.x,
      indicatorW: best.w,
    };
  }

  function nodePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    if (drag.mode === 'maybe') {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      if (drag.kind === 'connect') {
        const w = toWorld(e);
        setDrag({ mode: 'connect', id: drag.id, toX: w.x, toY: w.y, targetId: null, targetBlocked: false });
      } else {
        setDrag({ mode: 'reorder', id: drag.id, dx: 0, dy: 0, insertAt: null, indicatorY: 0, indicatorX: 0, indicatorW: 0 });
      }
      return;
    }
    const world = toWorld(e);
    if (drag.mode === 'reorder') {
      const origin = nodeById.get(drag.id);
      if (!origin) return;
      const ins = computeInsert(world, drag.id);
      setDrag({
        mode: 'reorder',
        id: drag.id,
        dx: world.x - (origin.x + origin.w / 2),
        dy: world.y - (origin.y + origin.h / 2),
        insertAt: ins?.insertAt ?? null,
        indicatorY: ins?.indicatorY ?? 0,
        indicatorX: ins?.indicatorX ?? 0,
        indicatorW: ins?.indicatorW ?? 0,
      });
    } else if (drag.mode === 'connect') {
      const target = layout.nodes.find(
        (n) => n.id !== drag.id && world.x >= n.x && world.x <= n.x + n.w && world.y >= n.y && world.y <= n.y + n.h,
      );
      // A live cycle check — only when the target changes, not on every mouse move
      const targetBlocked =
        target == null
          ? false
          : target.id === drag.targetId
            ? drag.targetBlocked
            : wouldCreateCycle(drag.id, target.id);
      setDrag({ mode: 'connect', id: drag.id, toX: world.x, toY: world.y, targetId: target?.id ?? null, targetBlocked });
    }
  }

  /** Would connecting source→target create a new routing cycle? */
  function wouldCreateCycle(sourceId: string, targetId: string): boolean {
    const candidate = withConnection(config, sourceId, targetId);
    if (!candidate) return false;
    const existing = new Set(issues.filter((i) => i.code === 'cycle').map((i) => i.message));
    return validateConfig(candidate.cfg).some((i) => i.code === 'cycle' && !existing.has(i.message));
  }

  function nodePointerUp(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    if (!drag) return;
    if (drag.mode === 'maybe') {
      setDrag(null);
      if (drag.kind === 'reorder') onSelect(id);
      return;
    }
    if (drag.mode === 'reorder') {
      const from = config.screens.findIndex((s) => s.id === drag.id);
      const to = drag.insertAt;
      setDrag(null);
      if (to !== null && from >= 0 && to !== from) {
        onUpdate((cfg) => {
          const screens = [...cfg.screens];
          const [moved] = screens.splice(from, 1);
          screens.splice(to, 0, moved);
          return { ...cfg, screens };
        });
      }
      return;
    }
    // connect
    const targetId = drag.targetId;
    const sourceId = drag.id;
    const blocked = drag.targetBlocked;
    setDrag(null);
    if (!targetId || targetId === sourceId) return;
    const planned = withConnection(config, sourceId, targetId);
    if (!planned) return;
    // A cycle? We hand it to the guard in AdminApp anyway — it will block it and show the explanation
    onUpdate((cfg) => withConnection(cfg, sourceId, targetId)?.cfg ?? cfg);
    if (!blocked) setPopover({ kind: 'rule', screenId: sourceId, ruleIndex: planned.at });
  }

  /* ---------- in-place text editing ---------- */

  function commitText(id: string, value: string) {
    setEditingId(null);
    onUpdate((cfg) => ({
      ...cfg,
      screens: cfg.screens.map((s) => {
        if (s.id !== id) return s;
        const { field } = nodeMainText(s);
        return { ...s, [field]: value } as Screen;
      }),
    }));
  }

  /* ---------- duplicate / delete ---------- */

  function duplicate(id: string) {
    onUpdate((cfg) => ({ ...cfg, screens: duplicateScreen(cfg.screens, id) }));
  }

  function remove(id: string) {
    // By name and not by id — that is what the editor sees in the diagram, and a
    // delete confirmation is precisely where "s_status" makes them delete the wrong
    // screen
    if (!window.confirm(`למחוק את המסך ״${screenRef(naming, id)}״?`)) return;
    onUpdate((cfg) => ({ ...cfg, screens: cfg.screens.filter((s) => s.id !== id) }));
    setPopover(null);
  }

  /* ---------- edges: hover, + and labels ---------- */

  /** Deleting a routing rule — from the popover or from the edge's right-click menu */
  function removeRule(screenId: string, ruleIndex: number) {
    onUpdate((cfg) => ({
      ...cfg,
      screens: cfg.screens.map((s) => {
        if (s.id !== screenId) return s;
        const rules = (s.next ?? []).filter((_, i) => i !== ruleIndex);
        return { ...s, next: rules.length > 0 ? rules : undefined } as Screen;
      }),
    }));
    setPopover(null);
  }

  /** A right-click on an edge or its label — an action menu (edit the condition, delete the connection) */
  function openEdgeMenu(ev: React.MouseEvent, edgeIndex: number) {
    ev.preventDefault();
    ev.stopPropagation();
    // A quota route has no rule to edit or delete — the engine adds it
    if (layout.edges[edgeIndex]?.kind === 'quota') return;
    const w = toWorld(ev);
    setPopover({ kind: 'edgeMenu', edgeIndex, x: w.x, y: w.y });
  }

  function edgeEnter(i: number) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredEdge(i);
  }

  function edgeLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoveredEdge(null), 250);
  }

  function insertScreen(pop: Extract<Popover, { kind: 'insert' | 'append' }>, type: Screen['type'], rawId: string) {
    const id = rawId.trim();
    onUpdate((cfg) => {
      const screens = [...cfg.screens];
      const fresh = newScreenOfType(type, id);
      if (pop.kind === 'append') {
        screens.push(fresh);
        return { ...cfg, screens };
      }
      if (pop.edgeKind === 'primary') {
        // Inserting into the ordinary continuation: the screen goes in right after the source in the sequence
        const srcIdx = screens.findIndex((s) => s.id === pop.fromId);
        if (srcIdx < 0) return cfg;
        screens.splice(srcIdx + 1, 0, fresh);
        return { ...cfg, screens };
      }
      // Inserting on a goto edge: the rule is routed to the new screen, and that
      // screen continues to the original target. The new screen sits at the end of
      // the array — so no existing fall-through can run into it by accident.
      fresh.next = [{ goto: pop.toId }];
      screens.push(fresh);
      const srcIdx2 = screens.findIndex((s) => s.id === pop.fromId);
      if (srcIdx2 >= 0 && pop.ruleIndex !== undefined) {
        const src = screens[srcIdx2];
        const rules = [...(src.next ?? [])];
        if (rules[pop.ruleIndex]?.goto === pop.toId) {
          rules[pop.ruleIndex] = { ...rules[pop.ruleIndex], goto: id };
          screens[srcIdx2] = { ...src, next: rules } as Screen;
        }
      }
      return { ...cfg, screens };
    });
    setPopover(null);
    onSelect(id);
  }

  /* ---------- rendering ---------- */

  if (layout.nodes.length === 0) {
    return <div className="admin-empty subtle">אין עדיין מסכים להציג</div>;
  }

  const connectSource = drag?.mode === 'connect' ? nodeById.get(drag.id) : null;

  // A live anchor for the condition popover — it stays attached to its edge even after a relayout
  function popoverAnchor(pop: Popover): Point {
    if (pop.kind === 'insert' || pop.kind === 'append' || pop.kind === 'edgeMenu') return { x: pop.x, y: pop.y };
    if (pop.kind === 'rule') {
      const e = layout.edges.find((ed) => ed.from === pop.screenId && ed.ruleIndex === pop.ruleIndex);
      if (e) return { x: e.labelX, y: e.labelY };
      const n = nodeById.get(pop.screenId);
      return n ? { x: n.x + n.w / 2, y: n.y + n.h } : { x: 0, y: 0 };
    }
    const n = nodeById.get(pop.screenId);
    return n ? { x: n.x + n.w / 2, y: n.y } : { x: 0, y: 0 };
  }

  /**
   * From the anchor in world space to a fixed position on the canvas.
   *
   * The popover used to sit inside the scaled layer and undo the scaling itself
   * (scale(1/k)) — that double computation shifted it away from its anchor and
   * changed its size with the zoom, and at the edges it simply left the screen. It
   * now lives in screen coordinates: one size at every zoom level, and always
   * inside the canvas — below its anchor, and above it when there is no room
   * there.
   */
  function popoverScreenPos(a: Point): { left: number; top: number } {
    const cw = canvasSize.w || containerRef.current?.clientWidth || 0;
    const ch = canvasSize.h || containerRef.current?.clientHeight || 0;
    const ax = view.x + a.x * view.k;
    const ay = view.y + a.y * view.k;
    const { w, h } = popSize;
    let top = ay + POPOVER_GAP;
    if (top + h > ch - POPOVER_PAD && ay - POPOVER_GAP - h >= POPOVER_PAD) top = ay - POPOVER_GAP - h;
    const inside = (v: number, size: number, box: number) =>
      Math.min(Math.max(v, POPOVER_PAD), Math.max(POPOVER_PAD, box - POPOVER_PAD - size));
    return { left: inside(ax - w / 2, w, cw), top: inside(top, h, ch) };
  }

  const popScreen = popover && 'screenId' in popover ? config.screens.find((s) => s.id === popover.screenId) : null;
  const popPos = popover ? popoverScreenPos(popoverAnchor(popover)) : null;

  return (
    <div className="flow-graph">
      <div className="fg-toolbar">
        <button
          className="a-btn ghost small"
          onClick={(e) => {
            const rect = containerRef.current!.getBoundingClientRect();
            const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPopover({
              kind: 'append',
              x: (btn.left + btn.width / 2 - rect.left - view.x) / view.k,
              y: (btn.bottom + 12 - rect.top - view.y) / view.k,
            });
          }}
        >
          <PlusIcon /> מסך חדש
        </button>
        <span className="fg-sep" />
        <button className="a-icon-btn" onClick={() => zoomBy(1.25)} aria-label="הגדלת התרשים" title="הגדלת התרשים">
          <ZoomIn />
        </button>
        <button className="a-icon-btn" onClick={() => zoomBy(0.8)} aria-label="הקטנת התרשים" title="הקטנת התרשים">
          <ZoomOut />
        </button>
        <button className="a-icon-btn" onClick={fit} aria-label="הצגת כל התרשים" title="הצגת כל התרשים">
          <FitIcon />
        </button>
        <span className="fg-zoom">{Math.round(view.k * 100)}%</span>
      </div>

      <div
        className={`fg-canvas${drag?.mode === 'connect' ? ' connecting' : ''}`}
        ref={containerRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="fg-world"
          // --fg-k lets the controls on a node undo the shrinking and stay a clickable size
          style={
            {
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
              width: layout.width,
              height: layout.height,
              '--fg-k': view.k,
            } as CSSProperties
          }
        >
          <svg key={geomSig} className="fg-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              {['fg-arrow', 'fg-arrow-active'].map((id) => (
                <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,1 L7,4 L0,7 z" className={`fg-arrow-head${id.endsWith('active') ? ' active' : ''}`} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((e, i) => {
              const active = selectedId === e.from || selectedId === e.to;
              // Lines that carry no information — skips ("if the screen below is
              // hidden, carry on downwards") and end signs — are not drawn by default;
              // selecting either end brings them back
              if (!active && (e.quiet || (e.kind === 'skip' && !e.structural))) return null;
              return (
                <g key={i}>
                  <path
                    d={e.path}
                    className={[
                      'fg-edge',
                      e.conditional ? 'conditional' : '',
                      e.kind === 'skip' ? (e.structural ? 'skip branch' : 'skip') : '',
                      active ? 'active' : '',
                      focusIds && !active ? 'dim' : '',
                      pathEdges?.has(`${e.from}→${e.to}`) ? 'on-path' : '',
                      pathEdges && !pathEdges.has(`${e.from}→${e.to}`) ? 'off-path' : '',
                    ].join(' ')}
                    markerEnd={`url(#${active ? 'fg-arrow-active' : 'fg-arrow'})`}
                  />
                  {e.kind !== 'skip' && (
                    <path
                      d={e.path}
                      className="fg-edge-hit"
                      onPointerEnter={() => edgeEnter(i)}
                      onPointerLeave={edgeLeave}
                      onContextMenu={(ev) => openEdgeMenu(ev, i)}
                    />
                  )}
                  {/* A path revealed by focus: the condition on hover, instead of a label on the canvas */}
                  {e.kind === 'skip' && active && e.label && (
                    <path d={e.path} className="fg-edge-hit passive">
                      <title>{`${screenRef(naming, e.from)} ← ${screenRef(naming, e.to)}: ${e.label}`}</title>
                    </path>
                  )}
                </g>
              );
            })}
            {connectSource && drag?.mode === 'connect' && (
              <line
                className={`fg-connect-line${drag.targetBlocked ? ' blocked' : ''}`}
                x1={connectSource.x + connectSource.w / 2}
                y1={connectSource.y + connectSource.h}
                x2={drag.toX}
                y2={drag.toY}
              />
            )}
          </svg>

          {layout.edges
            .map((e, i) => ({ ...e, i }))
            // Paths revealed by a selection get no label: one screen can skip to
            // dozens of screens, and every one of those labels is a repeat of the
            // target's display condition. The line shows "where you can get to"; the
            // condition itself is on hovering the line and on clicking it.
            .filter((e) => e.label && !e.quiet && (e.kind !== 'skip' || e.structural))
            .map((e) => (
              <button
                key={`l${e.i}`}
                className={[
                  'fg-edge-label',
                  selectedId === e.from || selectedId === e.to ? 'active' : '',
                  focusIds && selectedId !== e.from && selectedId !== e.to ? 'dim' : '',
                ].join(' ')}
                style={{ left: e.labelX, top: e.labelY }}
                title={
                  e.kind === 'quota'
                    ? `${e.label} — ניתוב אוטומטי לפי המכסה, אין כאן תנאי לערוך`
                    : `${e.label} — לחצו כדי לערוך את התנאי`
                }
                onContextMenu={(ev) => openEdgeMenu(ev, e.i)}
                onClick={() => {
                  // Nothing to edit on a quota route — take the admin to the
                  // screen it leads to instead, which is what they came to see
                  if (e.kind === 'quota') return onSelect(e.to);
                  setPopover(
                    e.kind === 'goto' && e.ruleIndex !== undefined
                      ? { kind: 'rule', screenId: e.from, ruleIndex: e.ruleIndex }
                      : { kind: 'showIf', screenId: e.to },
                  );
                }}
              >
                {shortLabel(e.label)}
              </button>
            ))}

          {hoveredEdge !== null &&
            layout.edges[hoveredEdge] &&
            layout.edges[hoveredEdge].kind !== 'skip' &&
            layout.edges[hoveredEdge].kind !== 'quota' &&
            !drag && (
            <button
              className="fg-insert-btn"
              style={{
                left: layout.edges[hoveredEdge].labelX + (layout.edges[hoveredEdge].label ? 26 : 0),
                top: layout.edges[hoveredEdge].labelY,
              }}
              onPointerEnter={() => edgeEnter(hoveredEdge)}
              onPointerLeave={edgeLeave}
              onClick={() => {
                const e = layout.edges[hoveredEdge];
                setPopover({
                  kind: 'insert',
                  fromId: e.from,
                  toId: e.to,
                  edgeKind: e.kind === 'goto' ? 'goto' : 'primary',
                  ruleIndex: e.ruleIndex,
                  x: e.labelX,
                  y: e.labelY,
                });
              }}
              title="הוספת מסך חדש באמצע המעבר הזה"
              aria-label="הוספת מסך חדש באמצע המעבר הזה"
            >
              <PlusIcon />
            </button>
          )}

          {/* A lane heading: one condition, written once, that holds the whole
              column. Without it "track A" is 19 screens carrying 19 copies of the
              same condition. */}
          {layout.lanes.map((lane) => (
            <button
              key={`lane-${lane.ids[0]}`}
              className={[
                'fg-lane',
                selectedId && lane.ids.includes(selectedId) ? 'active' : '',
                simPath && !lane.ids.some((id) => simPath.includes(id)) ? 'off-path' : '',
              ].join(' ')}
              style={{ left: lane.x, top: lane.y - 26, width: NODE_W }}
              title={`${lane.ids.length} מסכים חולקים את התנאי הזה — לחצו כדי לערוך אותו לכולם יחד`}
              onClick={() => setPopover({ kind: 'showIf', screenId: lane.ids[0] })}
            >
              <span className="fg-lane-count">{lane.ids.length}</span>
              <span className="fg-lane-text">
                {/* The same wording as on the edges: the value alone, without "the respondent's track is" */}
                {shortLabel(
                  (() => {
                    const cond = config.screens.find((s) => s.id === lane.ids[0])?.showIf;
                    return cond ? describeCondition(cond, config.screens, config.varMeta) : 'תמיד';
                  })(),
                )}
              </span>
            </button>
          ))}

          {layout.stubs.map((st) => (
            <button
              key={`s${st.sourceId}-${st.targetId}-${st.ruleIndex}`}
              className={[
                'fg-stub',
                st.variant,
                selectedId === st.sourceId ? 'active' : '',
                focusIds && selectedId !== st.sourceId ? 'dim' : '',
              ].join(' ')}
              style={{ left: st.x, top: st.y }}
              title={`${st.label ? st.label + ' — ' : ''}מכאן קופצים אל "${screenRef(naming, st.targetId)}". לחצו כדי לערוך את הכלל`}
              onClick={() =>
                st.ruleIndex === undefined
                  ? onSelect(st.targetId)
                  : setPopover({ kind: 'rule', screenId: st.sourceId, ruleIndex: st.ruleIndex })
              }
            >
              <StopIcon />
              <span className="fg-stub-text">{shortLabel(st.label) || 'תמיד'}</span>
              <span className="fg-stub-target">{screenRef(naming, st.targetId)}</span>
            </button>
          ))}

          {layout.nodes.map((n) => {
            const screen = config.screens[n.arrayIndex];
            const dragging = drag?.mode === 'reorder' && drag.id === n.id;
            const isConnectTarget = drag?.mode === 'connect' && drag.targetId === n.id;
            const editing = editingId === n.id;
            return (
              <div
                key={n.id}
                className={[
                  'fg-node-wrap',
                  dragging ? 'dragging' : '',
                  isConnectTarget ? 'connect-target' : '',
                  isConnectTarget && drag?.mode === 'connect' && drag.targetBlocked ? 'blocked' : '',
                  changedIds.has(n.id) ? 'changed' : '',
                  focusIds && !focusIds.has(n.id) ? 'dim' : '',
                  pathSet?.has(n.id) ? 'on-path' : '',
                  pathSet && !pathSet.has(n.id) ? 'off-path' : '',
                ].join(' ')}
                style={{
                  left: n.x,
                  top: n.y,
                  width: n.w,
                  height: n.h,
                  transform: dragging ? `translate(${(drag as { dx: number }).dx}px, ${(drag as { dy: number }).dy}px)` : undefined,
                }}
              >
                <div
                  className={[
                    'fg-node',
                    n.type === 'end' ? 'is-end' : '',
                    n.id === selectedId ? 'selected' : '',
                    errorIds.has(n.id) ? 'has-error' : '',
                  ].join(' ')}
                  role="button"
                  tabIndex={0}
                  aria-current={n.id === selectedId}
                  onPointerDown={(e) => nodePointerDown(e, n.id, 'reorder')}
                  onPointerMove={nodePointerMove}
                  onPointerUp={(e) => nodePointerUp(e, n.id)}
                  onDoubleClick={() => setEditingId(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(n.id);
                    }
                  }}
                >
                  {/* The position number and not the id: that is what lets people
                      talk about a screen out loud ("screen 14"), and the id stays
                      available in the tooltip for whoever needs it */}
                  <span className="fg-node-head">
                    <TypeIcon type={n.type} />
                    <span className="fg-node-pos" title={n.id}>
                      {config.screens.findIndex((s) => s.id === n.id) + 1}
                    </span>
                  </span>
                  {!editing && <span className={`fg-node-text${n.type === 'end' ? ' end' : ''}`}>{n.text}</span>}
                </div>

                {editing && screen && (
                  <textarea
                    className="fg-inline-edit"
                    defaultValue={nodeMainText(screen).value}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => commitText(n.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        (e.target as HTMLTextAreaElement).blur();
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                )}

                {inboundStubs.has(n.id) && (
                  <span
                    className="fg-stub-in"
                    title={`קופצים לכאן מ-${inboundStubs.get(n.id)!.length} מקומות: ${inboundStubs
                      .get(n.id)!
                      .map((id) => screenRef(naming, id))
                      .join(' · ')}`}
                  >
                    <StopIcon />
                    {inboundStubs.get(n.id)!.length}
                  </span>
                )}

                <span className="fg-node-toolbar">
                  <button className="a-icon-btn" onClick={() => duplicate(n.id)} title="יצירת עותק של המסך" aria-label="יצירת עותק של המסך">
                    <CopyIcon />
                  </button>
                  <button className="a-icon-btn danger" onClick={() => remove(n.id)} title="מחיקת המסך" aria-label="מחיקת המסך">
                    <TrashIcon />
                  </button>
                </span>

                {n.type !== 'end' && (
                  <button
                    className="fg-port"
                    onPointerDown={(e) => nodePointerDown(e, n.id, 'connect')}
                    onPointerMove={nodePointerMove}
                    onPointerUp={(e) => nodePointerUp(e, n.id)}
                    title="גררו אל מסך אחר כדי ליצור קפיצה אליו"
                    aria-label="גררו אל מסך אחר כדי ליצור קפיצה אליו"
                  />
                )}
              </div>
            );
          })}

          {drag?.mode === 'reorder' && drag.insertAt !== null && (
            <div
              className="fg-drop-indicator"
              style={{ left: drag.indicatorX, top: drag.indicatorY, width: drag.indicatorW }}
            />
          )}
        </div>

        {/* Deliberately outside the scaled layer: the popover lives in screen
            coordinates, so its size is constant at every zoom and it stays inside
            the canvas */}
        {popover && popPos && (
          <div
            ref={popoverRef}
            className="fg-popover"
            style={{ left: popPos.left, top: popPos.top }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="fg-popover-head">
              <strong>
                {popover.kind === 'rule' && popScreen &&
                  `קפיצה: ${screenRef(naming, popover.screenId)} ← ${screenRef(naming, (popScreen.next ?? [])[popover.ruleIndex]?.goto ?? '')}`}
                {popover.kind === 'showIf' && `מתי מוצג — ${screenRef(naming, popover.screenId)}`}
                {(popover.kind === 'insert' || popover.kind === 'append') && 'מסך חדש'}
                {popover.kind === 'edgeMenu' &&
                  (layout.edges[popover.edgeIndex]
                    ? `${screenRef(naming, layout.edges[popover.edgeIndex].from)} ← ${screenRef(naming, layout.edges[popover.edgeIndex].to)}`
                    : '')}
              </strong>
              <button className="a-icon-btn" onClick={() => setPopover(null)} aria-label="סגירה">
                <CloseIcon />
              </button>
            </div>

            {popover.kind === 'rule' && popScreen && (popScreen.next ?? [])[popover.ruleIndex] && (
              <>
                <OptionalCondition
                  label="הקפיצה מתבצעת רק אם…"
                  value={(popScreen.next ?? [])[popover.ruleIndex].if}
                  onChange={(cond) =>
                    onUpdate((cfg) => ({
                      ...cfg,
                      screens: cfg.screens.map((s) => {
                        if (s.id !== popover.screenId) return s;
                        const rules = [...(s.next ?? [])];
                        const rule = rules[popover.ruleIndex];
                        rules[popover.ruleIndex] = cond ? { ...rule, if: cond } : { goto: rule.goto };
                        return { ...s, next: rules } as Screen;
                      }),
                    }))
                  }
                  naming={naming}
                />
                <button
                  className="a-btn danger-ghost small"
                  onClick={() => removeRule(popover.screenId, popover.ruleIndex)}
                >
                  <TrashIcon /> מחיקת הקפיצה
                </button>
              </>
            )}

            {popover.kind === 'showIf' && popScreen && (
              <>
                {laneOf(popover.screenId).length > 1 && (
                  <p className="a-hint">
                    התנאי הזה משותף ל-{laneOf(popover.screenId).length} מסכים שבאים ברצף, ושינוי
                    כאן חל על כולם.
                  </p>
                )}
                <OptionalCondition
                  label="המסך מוצג רק אם…"
                  value={popScreen.showIf}
                  onChange={(cond) => {
                    // The whole lane together: these screens are defined as sharing a
                    // condition, and an edit that splits them is nearly always a
                    // mistake rather than an intention
                    const targets = new Set(laneOf(popover.screenId));
                    onUpdate((cfg) => ({
                      ...cfg,
                      screens: cfg.screens.map((s) =>
                        targets.has(s.id) ? ({ ...s, showIf: cond } as Screen) : s,
                      ),
                    }));
                  }}
                  naming={naming}
                />
              </>
            )}

            {(popover.kind === 'insert' || popover.kind === 'append') && (
              <InsertForm
                screens={config.screens}
                onSubmit={(type, id) => insertScreen(popover, type, id)}
              />
            )}

            {popover.kind === 'edgeMenu' &&
              (() => {
                const e = layout.edges[popover.edgeIndex];
                if (!e) return null;
                if (e.kind === 'goto' && e.ruleIndex !== undefined) {
                  const ruleIndex = e.ruleIndex;
                  return (
                    <div className="fg-edge-menu">
                      <button
                        className="a-btn ghost small"
                        onClick={() => setPopover({ kind: 'rule', screenId: e.from, ruleIndex })}
                      >
                        עריכת התנאי לקפיצה
                      </button>
                      <button className="a-btn danger-ghost small" onClick={() => removeRule(e.from, ruleIndex)}>
                        <TrashIcon /> מחיקת הקפיצה
                      </button>
                    </div>
                  );
                }
                const targetShowIf = config.screens.find((s) => s.id === e.to)?.showIf;
                return (
                  <div className="fg-edge-menu">
                    {targetShowIf && (
                      <button
                        className="a-btn ghost small"
                        onClick={() => setPopover({ kind: 'showIf', screenId: e.to })}
                      >
                        עריכת התנאי שמחליט מתי המסך מוצג
                      </button>
                    )}
                    <p className="a-hint">
                      זהו המשך רגיל לפי סדר המסכים, ולכן אין כאן כלל שאפשר למחוק. כדי לשנות את
                      הזרימה, גררו את המסך למקום אחר ברצף, או צרו קפיצה מנקודת החיבור שבתחתית המסך.
                    </p>
                  </div>
                );
              })()}
          </div>
        )}
      </div>
    </div>
  );

  function zoomBy(f: number) {
    cancelFocusAnim();
    userMoved.current = true;
    setView((v) => {
      const el = containerRef.current;
      const cx = (el?.clientWidth ?? 0) / 2;
      const cy = (el?.clientHeight ?? 0) / 2;
      const k = clamp(v.k * f, minZoom.current, MAX_ZOOM);
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }
}

const NEW_TYPES: Screen['type'][] = ['info', 'consent', 'single', 'multi', 'matrix', 'number', 'text', 'end'];

function InsertForm({ screens, onSubmit }: { screens: Screen[]; onSubmit: (type: Screen['type'], id: string) => void }) {
  const [type, setType] = useState<Screen['type']>('single');
  // It arrives ready-made, as when adding from the list — adding a screen does not open with a technical question
  const [id, setId] = useState(() => uniqueId('screen', screens));
  const trimmed = id.trim();
  const idTaken = screens.some((s) => s.id === trimmed);
  const idValid = /^[a-zA-Z][a-zA-Z0-9_]*$/.test(trimmed) && !idTaken;

  return (
    <form
      className="fg-insert-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (idValid) onSubmit(type, trimmed);
      }}
    >
      <select className="a-select" value={type} onChange={(e) => setType(e.target.value as Screen['type'])} aria-label="סוג המסך החדש">
        {NEW_TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input
        className="a-input"
        value={id}
        onChange={(e) => setId(e.target.value)}
        aria-label="קוד המסך לקובץ הנתונים"
        dir="ltr"
      />
      {trimmed && !idValid && (
        <p className="a-hint error-text">
          {idTaken
            ? 'הקוד הזה כבר תפוס על ידי מסך אחר'
            : 'הקוד צריך להתחיל באות אנגלית, ולהמשיך באותיות אנגליות, ספרות או קו תחתון'}
        </p>
      )}
      <button className="a-btn primary small" type="submit" disabled={!idValid}>
        הוספה
      </button>
    </form>
  );
}

const ZoomIn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.6" y2="16.6" />
    <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.6" y2="16.6" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const FitIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
  </svg>
);
