// תרשים הזרימה — משטח העריכה הראשי של השאלון.
// אינטראקציות (בהשראת Typeform Logic Map / n8n):
//   לחיצה על צומת          → בחירה ופתיחת מגירת העריכה
//   לחיצה כפולה על הטקסט   → עריכת נוסח השאלה במקום
//   גרירת צומת             → שינוי מיקומו ברצף (הפריסה מתחשבת מחדש — התרשים
//                             לעולם לא משקר: המיקום תמיד משקף את סדר הזרימה בפועל)
//   גרירה מנקודת החיבור    → יצירת כלל ניתוב (goto) אל צומת היעד + חלונית תנאי
//   לחיצה על תווית קשת     → עריכת התנאי של אותה קשת (כלל goto או showIf של היעד)
//   ריחוף על קשת → +       → הוספת מסך בתוך אותו מעבר
//   ריחוף על צומת          → סרגל פעולות קטן: שכפול, מחיקה

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import type { Screen, SurveyConfig } from '../engine/types';
import type { ValidationIssue } from '../engine/validate';
import { buildFlow } from './graph';
import { OptionalCondition } from './ConditionBuilder';
import { TYPE_LABELS } from './labels';
import { CloseIcon, CopyIcon, PlusIcon, TrashIcon, TypeIcon } from './Icons';

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
  kind: 'goto' | 'primary' | 'skip';
  ruleIndex?: number;
}

const EPS = 0.5;
const CORNER_R = 6;

/** מסלול אורתוגונלי (קווים ישרים, פניות ישרות) מנקודות הניתוב של dagre */
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

function uniqueId(base: string, screens: Screen[]): string {
  const taken = new Set(screens.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

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
  | { mode: 'connect'; id: string; toX: number; toY: number; targetId: string | null };

type Popover =
  | { kind: 'rule'; screenId: string; ruleIndex: number }
  | { kind: 'showIf'; screenId: string }
  | { kind: 'insert'; fromId: string; toId: string; edgeKind: 'goto' | 'primary'; ruleIndex?: number; x: number; y: number }
  | { kind: 'append'; x: number; y: number };

interface Props {
  config: SurveyConfig;
  issues: ValidationIssue[];
  selectedId: string | null;
  vars: string[];
  onSelect: (id: string) => void;
  onUpdate: (fn: (cfg: SurveyConfig) => SurveyConfig) => void;
}

export function FlowGraph({ config, issues, selectedId, vars, onSelect, onUpdate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const errorIds = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.screenId).map((i) => i.screenId!)),
    [issues],
  );

  const layout = useMemo(() => {
    const flow = buildFlow(config);
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'TB', nodesep: 30, ranksep: 54, edgesep: 18, marginx: 28, marginy: 28 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const node of flow.nodes) {
      g.setNode(node.id, { width: NODE_W, height: node.screen.type === 'end' ? END_H : NODE_H });
    }
    flow.edges.forEach((e, i) => {
      const showLabel = e.label && e.kind !== 'skip';
      const labelW = showLabel ? clamp(e.label.length * 6.4 + 14, 30, 150) : 0;
      g.setEdge(e.from, e.to, { width: labelW, height: showLabel ? 18 : 0, labelpos: 'c' }, String(i));
    });
    dagre.layout(g);

    const nodes: LaidOutNode[] = flow.nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        arrayIndex: config.screens.findIndex((s) => s.id === n.id),
        x: pos.x - pos.width / 2,
        y: pos.y - pos.height / 2,
        w: pos.width,
        h: pos.height,
        text: n.text,
        type: n.screen.type,
      };
    });
    const edges: LaidOutEdge[] = flow.edges.map((e, i) => {
      const le = g.edge({ v: e.from, w: e.to, name: String(i) });
      const pts = le.points as Point[];
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
      return {
        from: e.from,
        to: e.to,
        path: orthogonalPath(pts),
        label: e.label,
        labelX: le.x ?? mid.x,
        labelY: le.y ?? mid.y,
        conditional: e.conditional,
        kind: e.kind,
        ruleIndex: e.ruleIndex,
      };
    });
    const graph = g.graph();
    return { nodes, edges, width: graph.width ?? 0, height: graph.height ?? 0 };
  }, [config]);

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.width === 0) return;
    const k = clamp(
      Math.min((el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height),
      0.25,
      1,
    );
    setView({ x: (el.clientWidth - layout.width * k) / 2, y: 16, k });
    // הפריסה השתנתה מהותית? נעדכן רק בטעינה הראשונה — לא בכל עריכה
  }, [layout.width, layout.height]);

  const didFit = useRef(false);
  useEffect(() => {
    if (!didFit.current) {
      didFit.current = true;
      fit();
    }
  }, [fit]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 0.25, 2);
        const ratio = k / v.k;
        return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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

  /* ---------- פאן ---------- */

  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  function startPan(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('.fg-node-wrap, .fg-popover, .fg-toolbar, .fg-edge-label, .fg-insert-btn')) return;
    setPopover(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
  }

  function movePan(e: React.PointerEvent) {
    const p = panRef.current;
    if (!p) return;
    setView((v) => ({ ...v, x: p.vx + (e.clientX - p.px), y: p.vy + (e.clientY - p.py) }));
  }

  function endPan(e: React.PointerEvent) {
    panRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  /* ---------- גרירת צומת: שינוי סדר / חיבור ---------- */

  function nodePointerDown(e: React.PointerEvent, id: string, kind: 'reorder' | 'connect') {
    if (e.button !== 0) return;
    e.stopPropagation();
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
        setDrag({ mode: 'connect', id: drag.id, toX: w.x, toY: w.y, targetId: null });
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
      setDrag({ mode: 'connect', id: drag.id, toX: world.x, toY: world.y, targetId: target?.id ?? null });
    }
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
    setDrag(null);
    if (!targetId || targetId === sourceId) return;
    const source = config.screens.find((s) => s.id === sourceId);
    if (!source || source.type === 'end') return;
    const rules = source.next ?? [];
    const uncondIdx = rules.findIndex((r) => !r.if);
    const at = uncondIdx === -1 ? rules.length : uncondIdx;
    onUpdate((cfg) => ({
      ...cfg,
      screens: cfg.screens.map((s) =>
        s.id === sourceId
          ? ({ ...s, next: [...rules.slice(0, at), { goto: targetId }, ...rules.slice(at)] } as Screen)
          : s,
      ),
    }));
    setPopover({ kind: 'rule', screenId: sourceId, ruleIndex: at });
  }

  /* ---------- עריכת טקסט במקום ---------- */

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

  /* ---------- שכפול / מחיקה ---------- */

  function duplicate(id: string) {
    onUpdate((cfg) => {
      const idx = cfg.screens.findIndex((s) => s.id === id);
      if (idx < 0) return cfg;
      const copy = JSON.parse(JSON.stringify(cfg.screens[idx])) as Screen;
      copy.id = uniqueId(`${id}_2`, cfg.screens);
      const screens = [...cfg.screens];
      screens.splice(idx + 1, 0, copy);
      return { ...cfg, screens };
    });
  }

  function remove(id: string) {
    if (!window.confirm(`למחוק את המסך "${id}"?`)) return;
    onUpdate((cfg) => ({ ...cfg, screens: cfg.screens.filter((s) => s.id !== id) }));
    setPopover(null);
  }

  /* ---------- קשתות: ריחוף, + ותוויות ---------- */

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
        // הוספה בתוך ההמשך הרגיל: המסך נכנס מיד אחרי המקור ברצף
        const srcIdx = screens.findIndex((s) => s.id === pop.fromId);
        if (srcIdx < 0) return cfg;
        screens.splice(srcIdx + 1, 0, fresh);
        return { ...cfg, screens };
      }
      // הוספה על קשת goto: הכלל מנותב אל המסך החדש, והוא ממשיך אל היעד המקורי.
      // המסך החדש יושב בסוף המערך — כך אף fall-through קיים לא ייתקל בו בטעות.
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

  /* ---------- רינדור ---------- */

  if (layout.nodes.length === 0) {
    return <div className="admin-empty subtle">אין מסכים להצגה</div>;
  }

  const connectSource = drag?.mode === 'connect' ? nodeById.get(drag.id) : null;

  // עוגן חי לחלונית תנאי — נצמד לקשת גם אחרי פריסה מחדש
  function popoverAnchor(pop: Popover): Point {
    if (pop.kind === 'insert' || pop.kind === 'append') return { x: pop.x, y: pop.y };
    if (pop.kind === 'rule') {
      const e = layout.edges.find((ed) => ed.from === pop.screenId && ed.ruleIndex === pop.ruleIndex);
      if (e) return { x: e.labelX, y: e.labelY };
      const n = nodeById.get(pop.screenId);
      return n ? { x: n.x + n.w / 2, y: n.y + n.h } : { x: 0, y: 0 };
    }
    const n = nodeById.get(pop.screenId);
    return n ? { x: n.x + n.w / 2, y: n.y } : { x: 0, y: 0 };
  }

  const popScreen = popover && 'screenId' in popover ? config.screens.find((s) => s.id === popover.screenId) : null;

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
          <PlusIcon /> מסך
        </button>
        <span className="fg-sep" />
        <button className="a-icon-btn" onClick={() => zoomBy(1.25)} aria-label="הגדלה" title="הגדלה">
          <ZoomIn />
        </button>
        <button className="a-icon-btn" onClick={() => zoomBy(0.8)} aria-label="הקטנה" title="הקטנה">
          <ZoomOut />
        </button>
        <button className="a-icon-btn" onClick={fit} aria-label="התאמה למסך" title="התאמה למסך">
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
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: layout.width, height: layout.height }}
        >
          <svg className="fg-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              {['fg-arrow', 'fg-arrow-active'].map((id) => (
                <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,1 L7,4 L0,7 z" className={`fg-arrow-head${id.endsWith('active') ? ' active' : ''}`} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((e, i) => {
              const active = selectedId === e.from || selectedId === e.to;
              return (
                <g key={i}>
                  <path
                    d={e.path}
                    className={['fg-edge', e.conditional ? 'conditional' : '', e.kind === 'skip' ? 'skip' : '', active ? 'active' : ''].join(' ')}
                    markerEnd={`url(#${active ? 'fg-arrow-active' : 'fg-arrow'})`}
                  />
                  {e.kind !== 'skip' && (
                    <path
                      d={e.path}
                      className="fg-edge-hit"
                      onPointerEnter={() => edgeEnter(i)}
                      onPointerLeave={edgeLeave}
                    />
                  )}
                </g>
              );
            })}
            {connectSource && drag?.mode === 'connect' && (
              <line
                className="fg-connect-line"
                x1={connectSource.x + connectSource.w / 2}
                y1={connectSource.y + connectSource.h}
                x2={drag.toX}
                y2={drag.toY}
              />
            )}
          </svg>

          {layout.edges
            .map((e, i) => ({ ...e, i }))
            .filter((e) => e.label && (e.kind !== 'skip' || selectedId === e.from || selectedId === e.to))
            .map((e) => (
              <button
                key={`l${e.i}`}
                className={`fg-edge-label${selectedId === e.from || selectedId === e.to ? ' active' : ''}`}
                style={{ left: e.labelX, top: e.labelY }}
                title={`${e.label} — לחיצה לעריכת התנאי`}
                onClick={() =>
                  setPopover(
                    e.kind === 'goto' && e.ruleIndex !== undefined
                      ? { kind: 'rule', screenId: e.from, ruleIndex: e.ruleIndex }
                      : { kind: 'showIf', screenId: e.to },
                  )
                }
              >
                {e.label}
              </button>
            ))}

          {hoveredEdge !== null && layout.edges[hoveredEdge] && layout.edges[hoveredEdge].kind !== 'skip' && !drag && (
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
              title="הוספת מסך בתוך המעבר הזה"
              aria-label="הוספת מסך בתוך המעבר הזה"
            >
              <PlusIcon />
            </button>
          )}

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
                  <span className="fg-node-head">
                    <TypeIcon type={n.type} />
                    <code dir="ltr">{n.id}</code>
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

                <span className="fg-node-toolbar">
                  <button className="a-icon-btn" onClick={() => duplicate(n.id)} title="שכפול המסך" aria-label="שכפול המסך">
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
                    title="גרירה אל מסך אחר ליצירת כלל ניתוב"
                    aria-label="גרירה אל מסך אחר ליצירת כלל ניתוב"
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

          {popover && (
            <div
              className="fg-popover"
              style={{
                left: popoverAnchor(popover).x,
                top: popoverAnchor(popover).y + 14,
                // מתקזז עם הזום של הקנבס — הטופס תמיד בגודל קריא
                transform: `translateX(-50%) scale(${1 / view.k})`,
                transformOrigin: 'top center',
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="fg-popover-head">
                <strong>
                  {popover.kind === 'rule' && popScreen && `כלל ניתוב: ${popover.screenId} ← ${(popScreen.next ?? [])[popover.ruleIndex]?.goto ?? ''}`}
                  {popover.kind === 'showIf' && `תנאי תצוגה: ${popover.screenId}`}
                  {(popover.kind === 'insert' || popover.kind === 'append') && 'מסך חדש'}
                </strong>
                <button className="a-icon-btn" onClick={() => setPopover(null)} aria-label="סגירה">
                  <CloseIcon />
                </button>
              </div>

              {popover.kind === 'rule' && popScreen && (popScreen.next ?? [])[popover.ruleIndex] && (
                <>
                  <OptionalCondition
                    label="מתבצע בתנאי ש… (בלי תנאי — תמיד)"
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
                    screens={config.screens}
                    vars={vars}
                  />
                  <button
                    className="a-btn danger-ghost small"
                    onClick={() => {
                      onUpdate((cfg) => ({
                        ...cfg,
                        screens: cfg.screens.map((s) => {
                          if (s.id !== popover.screenId) return s;
                          const rules = (s.next ?? []).filter((_, i) => i !== popover.ruleIndex);
                          return { ...s, next: rules.length > 0 ? rules : undefined } as Screen;
                        }),
                      }));
                      setPopover(null);
                    }}
                  >
                    <TrashIcon /> מחיקת הכלל
                  </button>
                </>
              )}

              {popover.kind === 'showIf' && popScreen && (
                <OptionalCondition
                  label="המסך מוצג רק כאשר…"
                  value={popScreen.showIf}
                  onChange={(cond) =>
                    onUpdate((cfg) => ({
                      ...cfg,
                      screens: cfg.screens.map((s) =>
                        s.id === popover.screenId ? ({ ...s, showIf: cond } as Screen) : s,
                      ),
                    }))
                  }
                  screens={config.screens}
                  vars={vars}
                />
              )}

              {(popover.kind === 'insert' || popover.kind === 'append') && (
                <InsertForm
                  screens={config.screens}
                  onSubmit={(type, id) => insertScreen(popover, type, id)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function zoomBy(f: number) {
    setView((v) => {
      const el = containerRef.current;
      const cx = (el?.clientWidth ?? 0) / 2;
      const cy = (el?.clientHeight ?? 0) / 2;
      const k = clamp(v.k * f, 0.25, 2);
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  }
}

const NEW_TYPES: Screen['type'][] = ['info', 'consent', 'single', 'multi', 'matrix', 'number', 'text', 'end'];

function InsertForm({ screens, onSubmit }: { screens: Screen[]; onSubmit: (type: Screen['type'], id: string) => void }) {
  const [type, setType] = useState<Screen['type']>('single');
  const [id, setId] = useState('');
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
      <select className="a-select" value={type} onChange={(e) => setType(e.target.value as Screen['type'])} aria-label="סוג מסך">
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
        placeholder="מזהה באנגלית, למשל s_income"
        dir="ltr"
        autoFocus
      />
      {trimmed && !idValid && (
        <p className="a-hint error-text">
          {idTaken ? 'המזהה כבר קיים' : 'מזהה חוקי: אותיות אנגליות, ספרות וקו תחתון, מתחיל באות'}
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
