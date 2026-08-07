// תרשים זרימה של השאלון: כל צומת הוא מסך (עם נוסח השאלה), וכל קשת נושאת
// את התשובה שמובילה למסך הבא. לחיצה על צומת פותחת את הגדרות אותו מסך.
// פריסה: dagre (מלמעלה למטה). קשתות ב-SVG, צמתים כ-HTML (טקסט עברי נשבר כראוי).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import type { SurveyConfig } from '../engine/types';
import type { ValidationIssue } from '../engine/validate';
import { buildFlow } from './graph';
import { TypeIcon } from './Icons';

const NODE_W = 236;
const NODE_H = 74;
const END_H = 52;

interface Point {
  x: number;
  y: number;
}

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  type: string;
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
}

const EPS = 0.5;
const CORNER_R = 6;

/**
 * הופך את נקודות הניתוב של dagre למסלול אורתוגונלי (קווים ישרים בלבד,
 * פניות בזווית ישרה) בסגנון תרשים זרימה — במקום עקומות בזייה.
 * בכל שינוי כיוון יורדים אנכית ואז זזים אופקית, כפי שמצופה בפריסה מלמעלה למטה.
 */
function orthogonalPath(pts: Point[]): string {
  if (pts.length < 2) return '';

  // 1. מדרגות: אף מקטע לא אלכסוני
  const steps: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = steps[steps.length - 1];
    const cur = pts[i];
    if (Math.abs(cur.x - prev.x) > EPS && Math.abs(cur.y - prev.y) > EPS) {
      steps.push({ x: prev.x, y: cur.y });
    }
    steps.push(cur);
  }

  // 2. ניקוי נקודות כפולות ונקודות על אותו קו
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

  // 3. פינות מעוגלות קלות — נשאר אורתוגונלי, רק פחות חד
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

interface Props {
  config: SurveyConfig;
  issues: ValidationIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FlowGraph({ config, issues, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });

  const errorIds = useMemo(
    () => new Set(issues.filter((i) => i.level === 'error' && i.screenId).map((i) => i.screenId!)),
    [issues],
  );

  const layout = useMemo(() => {
    const flow = buildFlow(config);
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({
      rankdir: 'TB',
      nodesep: 30,
      ranksep: 54,
      edgesep: 18,
      marginx: 28,
      marginy: 28,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of flow.nodes) {
      g.setNode(node.id, {
        width: NODE_W,
        height: node.screen.type === 'end' ? END_H : NODE_H,
      });
    }
    flow.edges.forEach((e, i) => {
      // קשתות דילוג לא מקבלות תווית קבועה (היא נחשפת רק בבחירה), ולכן
      // גם לא שומרות לה מקום בפריסה
      const showLabel = e.label && e.kind !== 'skip';
      const labelW = showLabel ? clamp(e.label.length * 6.4 + 14, 30, 150) : 0;
      g.setEdge(e.from, e.to, { width: labelW, height: showLabel ? 18 : 0, labelpos: 'c' }, String(i));
    });

    dagre.layout(g);

    const nodes: LaidOutNode[] = flow.nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        id: n.id,
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
      // לקשתות דילוג לא הוקצתה תווית בפריסה — ממקמים באמצע המסלול
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
      };
    });

    const graph = g.graph();
    return { nodes, edges, width: graph.width ?? 0, height: graph.height ?? 0 };
  }, [config]);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.width === 0) return;
    const k = clamp(
      Math.min((el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height),
      0.25,
      1,
    );
    setView({
      x: (el.clientWidth - layout.width * k) / 2,
      y: 16,
      k,
    });
  }, [layout]);

  useEffect(fit, [fit]);

  // wheel לא-פסיבי כדי שאפשר יהיה למנוע גלילת עמוד בזמן זום
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

  const panRef = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);

  function startPan(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('.fg-node')) return;
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
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const zoomBy = (f: number) =>
    setView((v) => {
      const el = containerRef.current;
      const cx = (el?.clientWidth ?? 0) / 2;
      const cy = (el?.clientHeight ?? 0) / 2;
      const k = clamp(v.k * f, 0.25, 2);
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });

  if (layout.nodes.length === 0) {
    return <div className="admin-empty subtle">אין מסכים להצגה</div>;
  }

  return (
    <div className="flow-graph">
      <div className="fg-toolbar">
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
        className="fg-canvas"
        ref={containerRef}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="fg-world"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            width: layout.width,
            height: layout.height,
          }}
        >
          <svg className="fg-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              {['fg-arrow', 'fg-arrow-active'].map((id) => (
                <marker
                  key={id}
                  id={id}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M0,1 L7,4 L0,7 z"
                    className={`fg-arrow-head${id.endsWith('active') ? ' active' : ''}`}
                  />
                </marker>
              ))}
            </defs>
            {layout.edges.map((e, i) => {
              const active = selectedId === e.from || selectedId === e.to;
              return (
                <path
                  key={i}
                  d={e.path}
                  className={[
                    'fg-edge',
                    e.conditional ? 'conditional' : '',
                    e.kind === 'skip' ? 'skip' : '',
                    active ? 'active' : '',
                  ].join(' ')}
                  markerEnd={`url(#${active ? 'fg-arrow-active' : 'fg-arrow'})`}
                />
              );
            })}
          </svg>

          {layout.edges
            .map((e, i) => ({ ...e, i }))
            // תוויות דילוג נחשפות רק כשהמסך נבחר — אחרת התרשים מוצף
            .filter(
              (e) =>
                e.label &&
                (e.kind !== 'skip' || selectedId === e.from || selectedId === e.to),
            )
            .map((e) => (
              <span
                key={e.i}
                className={`fg-edge-label${
                  selectedId === e.from || selectedId === e.to ? ' active' : ''
                }`}
                style={{ left: e.labelX, top: e.labelY }}
                title={e.label}
              >
                {e.label}
              </span>
            ))}

          {layout.nodes.map((n) => (
            <button
              key={n.id}
              className={[
                'fg-node',
                n.type === 'end' ? 'is-end' : '',
                n.id === selectedId ? 'selected' : '',
                errorIds.has(n.id) ? 'has-error' : '',
              ].join(' ')}
              style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
              onClick={() => onSelect(n.id)}
              aria-current={n.id === selectedId}
            >
              <span className="fg-node-head">
                <TypeIcon type={n.type} />
                <code dir="ltr">{n.id}</code>
              </span>
              {n.type !== 'end' && <span className="fg-node-text">{n.text}</span>}
              {n.type === 'end' && <span className="fg-node-text end">{n.text}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
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
