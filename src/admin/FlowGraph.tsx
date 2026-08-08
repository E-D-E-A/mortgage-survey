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
import type { Condition, Screen, SurveyConfig } from '../engine/types';
import { validateConfig, type ValidationIssue } from '../engine/validate';
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
  /** קשת מבנית: כניסה לענף / התכנסות בין שורות סמוכות — התווית תמיד מוצגת */
  structural?: boolean;
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

/** כל המזהים (שאלות ומשתנים) שתנאי מסתמך עליהם */
const condRefs = (c: Condition): string[] =>
  'all' in c ? c.all.flatMap(condRefs)
  : 'any' in c ? c.any.flatMap(condRefs)
  : 'not' in c ? condRefs(c.not)
  : ['q' in c ? c.q : c.var];

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
  | { mode: 'connect'; id: string; toX: number; toY: number; targetId: string | null; targetBlocked: boolean };

type Popover =
  | { kind: 'rule'; screenId: string; ruleIndex: number }
  | { kind: 'showIf'; screenId: string }
  | { kind: 'insert'; fromId: string; toId: string; edgeKind: 'goto' | 'primary'; ruleIndex?: number; x: number; y: number }
  | { kind: 'append'; x: number; y: number }
  | { kind: 'edgeMenu'; edgeIndex: number; x: number; y: number };

/** הוספת כלל goto ממסך אל יעד — לפני הכלל הבלתי-מותנה אם קיים (שלא יהיה קוד מת) */
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

  // --- זיהוי "מה השתנה" — הצמתים שהעריכה האחרונה נגעה בהם מקבלים הבהוב ---
  // הקונפיג אימיוטבילי: מסך שהשתנה מקבל הפניה חדשה, ולכן השוואת הפניות
  // מזהה בדיוק את המסכים שנערכו/נוספו. שינוי סדר טהור לא מחליף הפניות —
  // מזוהה בנפרד ע"י מציאת המסך שהוצא מהרצף.
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

  // פריסה דטרמיניסטית "עץ מסלולים": רצף מסכים עם אותו showIf יוצר עמודת ענף,
  // ותנאים שונים ברצף אחד יושבים זה לצד זה — כמו מפת המסע ב-FigJam. המיקום
  // תלוי אך ורק בסדר המערך ובקיבוץ תנאי showIf (לא בקשתות!) — ולכן חיבור בין
  // צמתים לא מזיז שום צומת, ועריכה מזיזה רק את השורות שמתחתיה.
  const layout = useMemo(() => {
    const MARGIN = 40;
    const V_GAP = 56; // בין שורות — משמש גם כמסדרון לקווים האופקיים
    const INNER_GAP = 24; // בין מסכים באותו ענף
    const COL_W = NODE_W + 40; // רוחב עמודה כולל המרווח בין ענפים
    const LANE_GAP = 26; // מרחק הנתיב הראשון מהעמודות
    const LANE_W = 26; // מרווח בין נתיבים

    const flow = buildFlow(config);
    const screens = config.screens;

    // שורות: מסך ללא showIf = שורה מרכזית; רצף מסכי showIf = שורת ענפים.
    // ענף = מסכים עוקבים עם אותו תנאי (השוואת JSON), מוערמים אנכית.
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
      // מה כבר "נוצר" בשורה הנוכחית (מסכים ומשתני onSubmit) — ענף שתנאו
      // תלוי בזה חייב לרדת שורה: הזרימה עוברת דרך מה שמעליו
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

    // עמוד השדרה במרכז; שורת ענפים נפרסת סימטרית סביבו, הענף הראשון מימין
    const maxHalf = rows.reduce((m, r) => Math.max(m, ((r.branches.length - 1) / 2) * COL_W), 0);
    const spineX = MARGIN + maxHalf;

    const nodes: LaidOutNode[] = new Array(screens.length);
    const rowOf = new Map<string, number>();
    const headIds = new Set<string>(); // ראש עמודה — הכניסה מלמעלה פנויה
    const tailIds = new Set<string>(); // זנב עמודה — היציאה מלמטה פנויה
    let y = MARGIN;
    rows.forEach((row, ri) => {
      row.top = y;
      const n = row.branches.length;
      let rowBottom = y;
      row.branches.forEach((br, bi) => {
        const x = spineX + ((n - 1) / 2 - bi) * COL_W;
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

    // מפרץ g = הרווח האופקי שמעל שורה g (g === rows.length: מתחת לאחרונה).
    // כל מקור מקבל בו גובה משלו — קווים אופקיים שונים לא מתלכדים; אותו מקור
    // חולק גובה אחד, כך שמזלג נראה כגזע יחיד שמתפצל.
    const gapSlots = new Map<number, Map<string, number>>();
    const gapBase = (g: number) =>
      g < rows.length ? rows[g].top - V_GAP / 2 : rows[rows.length - 1].bottom + V_GAP / 2;
    const gapY = (g: number, key: string) => {
      let m = gapSlots.get(g);
      if (!m) gapSlots.set(g, (m = new Map()));
      if (!m.has(key)) m.set(key, m.size);
      const slot = m.get(key)!;
      const off = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 9;
      return clamp(gapBase(g) + off, gapBase(g) - V_GAP / 2 + 8, gapBase(g) + V_GAP / 2 - 8);
    };

    const mkEdge = (
      e: (typeof flow.edges)[number],
      pts: Point[],
      labelX: number,
      labelY: number,
      label: string,
      structural = false,
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
    });

    // קשתות שלא מסתדרות דרך המפרצים הסמוכים עוקפות בנתיב אנכי מימין לעמודות
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

    flow.edges.forEach((e, i) => {
      const s = byId.get(e.from);
      const t = byId.get(e.to);
      if (!s || !t) return;
      const rs = rowOf.get(e.from)!;
      const rt = rowOf.get(e.to)!;
      const scx = s.x + s.w / 2;
      const tcx = t.x + t.w / 2;

      // המשך ישיר בתוך ענף — בלי תווית (התנאי כבר כתוב על הכניסה לענף)
      if (rs === rt && s.x === t.x && Math.abs(t.y - (s.y + s.h + INNER_GAP)) < 1) {
        edges.push(mkEdge(e, [{ x: scx, y: s.y + s.h }, { x: tcx, y: t.y }], scx, (s.y + s.h + t.y) / 2, ''));
        return;
      }

      // מזלג/התכנסות בין שורות סמוכות — דרך המפרץ שמעל שורת היעד
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
          ),
        );
        return;
      }

      // בין ענפים שכנים באותה שורה — מעל השורה, כששני הראשים פנויים
      if (rs === rt && s.x !== t.x && headIds.has(s.id) && headIds.has(t.id)) {
        const yMid = gapY(rs, 'top:' + e.from);
        edges.push(
          mkEdge(
            e,
            [{ x: scx, y: s.y }, { x: scx, y: yMid }, { x: tcx, y: yMid }, { x: tcx, y: t.y }],
            (scx + tcx) / 2,
            yMid,
            e.label,
            true,
          ),
        );
        return;
      }

      // נתיב צד: יציאה מלמטה (זנב) או מצד הצומת (אמצע ענף), כניסה מלמעלה
      // (ראש) או מהצד — תמיד דרך המפרצים, כך שהקו לא חוצה אף צומת
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

    // הקצאת נתיבים בצביעת מרווחים; כללי goto לפני קשתות דילוג — הכללים
    // המשמעותיים ותוויותיהם צמודים לעמודות, בתוך כל קבוצה קצר לפני ארוך
    laneEdges.sort((a, b) => {
      const ga = a.e.kind === 'skip' ? 1 : 0;
      const gb = b.e.kind === 'skip' ? 1 : 0;
      if (ga !== gb) return ga - gb;
      return a.maxY - a.minY - (b.maxY - b.minY);
    });
    const laneEnds: { minY: number; maxY: number }[][] = [];
    let firstSkipLane = 0;
    for (const se of laneEdges) {
      let lane = se.e.kind === 'skip' ? firstSkipLane : 0;
      for (; lane < laneEnds.length; lane++) {
        if (laneEnds[lane].every((iv) => se.maxY < iv.minY - 6 || se.minY > iv.maxY + 6)) break;
      }
      (laneEnds[lane] ??= []).push({ minY: se.minY, maxY: se.maxY });
      se.lane = lane;
      if (se.e.kind !== 'skip') firstSkipLane = Math.max(firstSkipLane, lane + 1);
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

    const maxLane = laneEdges.reduce((m, se) => Math.max(m, se.lane), -1);
    return {
      nodes,
      edges,
      width: colsRight + LANE_GAP + (maxLane + 1) * LANE_W + MARGIN + 60,
      height: y - V_GAP + MARGIN,
    };
  }, [config]);

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);

  // חתימת גאומטריה: כשהפריסה זזה, שכבת הקשתות מתחלפת בעמעום (הצמתים
  // גולשים למקומם ב-CSS; קווי SVG לא ניתנים לאנימציה אמינה — מעמעמים במקום)
  const geomSig = useMemo(
    () =>
      layout.nodes.map((n) => `${n.id}:${Math.round(n.x)},${Math.round(n.y)}`).join('|') +
      '#' +
      layout.edges.length,
    [layout],
  );

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
    // פאן בלחצן שמאלי בלבד — לכידת מצביע בקליק ימני מסיטה את אירוע
    // ה-contextmenu מהקשת אל הקנבס ותפריט הקשת לא נפתח
    if (e.button !== 0) return;
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
      // בדיקת מעגל חיה — רק כשהיעד מתחלף, לא בכל תזוזת עכבר
      const targetBlocked =
        target == null
          ? false
          : target.id === drag.targetId
            ? drag.targetBlocked
            : wouldCreateCycle(drag.id, target.id);
      setDrag({ mode: 'connect', id: drag.id, toX: world.x, toY: world.y, targetId: target?.id ?? null, targetBlocked });
    }
  }

  /** האם חיבור מקור→יעד היה יוצר מעגל ניתוב חדש? */
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
    // מעגל? מעבירים בכל זאת לשומר שב-AdminApp — הוא יחסום ויציג את ההסבר
    onUpdate((cfg) => withConnection(cfg, sourceId, targetId)?.cfg ?? cfg);
    if (!blocked) setPopover({ kind: 'rule', screenId: sourceId, ruleIndex: planned.at });
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

  /** מחיקת כלל ניתוב — מהחלונית או מתפריט הקליק-הימני על הקשת */
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

  /** קליק ימני על קשת/תווית — תפריט פעולות (עריכת תנאי, מחיקת החיבור) */
  function openEdgeMenu(ev: React.MouseEvent, edgeIndex: number) {
    ev.preventDefault();
    ev.stopPropagation();
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
              return (
                <g key={i}>
                  <path
                    d={e.path}
                    className={['fg-edge', e.conditional ? 'conditional' : '', e.kind === 'skip' ? (e.structural ? 'skip branch' : 'skip') : '', active ? 'active' : ''].join(' ')}
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
            .filter((e) => e.label && (e.kind !== 'skip' || e.structural || selectedId === e.from || selectedId === e.to))
            .map((e) => (
              <button
                key={`l${e.i}`}
                className={`fg-edge-label${selectedId === e.from || selectedId === e.to ? ' active' : ''}`}
                style={{ left: e.labelX, top: e.labelY }}
                title={`${e.label} — לחיצה לעריכת התנאי`}
                onContextMenu={(ev) => openEdgeMenu(ev, e.i)}
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
                  isConnectTarget && drag?.mode === 'connect' && drag.targetBlocked ? 'blocked' : '',
                  changedIds.has(n.id) ? 'changed' : '',
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
                  {popover.kind === 'edgeMenu' &&
                    (layout.edges[popover.edgeIndex]
                      ? `${layout.edges[popover.edgeIndex].from} ← ${layout.edges[popover.edgeIndex].to}`
                      : '')}
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
                    onClick={() => removeRule(popover.screenId, popover.ruleIndex)}
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
                          עריכת התנאי
                        </button>
                        <button className="a-btn danger-ghost small" onClick={() => removeRule(e.from, ruleIndex)}>
                          <TrashIcon /> מחיקת החיבור
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
                          עריכת תנאי התצוגה
                        </button>
                      )}
                      <p className="a-hint">
                        זהו המשך רגיל לפי סדר המסכים — אין כלל למחוק. כדי לשנות את הזרימה גררו את
                        המסך למקום אחר ברצף או צרו כלל ניתוב מנקודת החיבור.
                      </p>
                    </div>
                  );
                })()}
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
