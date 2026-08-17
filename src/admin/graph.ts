// Deriving the flow graph from the config — faithful to the engine's semantics
// (findNext) down to the detail: explicit next rules first, and with no
// unconditional rule, a fall-through to the next screen that passes its showIf.
// The edge labels are the answer that leads to the next screen, with option ids
// translated into the wording the respondent sees.

import { quotaCells } from '../engine/quota';
import type { Condition, Screen, SurveyConfig, VarMeta } from '../engine/types';
import { fallThroughTargets } from './reachability';

type VarMetaMap = Record<string, VarMeta>;

const varName = (meta: VarMetaMap, name: string) => meta[name]?.label || name;
const varValue = (meta: VarMetaMap, name: string, value: unknown) =>
  meta[name]?.values?.[String(value)] ?? String(value);

export interface FlowNode {
  id: string;
  screen: Screen;
  /** The text shown in the node — the question itself */
  text: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** The answer/condition that leads to the target node */
  label: string;
  /** A default edge (an ordinary continuation) as opposed to a conditional one */
  conditional: boolean;
  /**
   * goto = explicit routing, primary = continuing to the next screen,
   * skip = a further landing after conditional screens are skipped (drawn dimmed),
   * quota = the route the engine adds itself when a marked value's cap is full —
   *   nobody wrote it and nobody can edit it, so it carries no rule to open
   */
  kind: 'goto' | 'primary' | 'skip' | 'quota';
  /** For goto edges: the rule's index in the source screen's next — so the condition can be edited from the edge */
  ruleIndex?: number;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** The wording the respondent sees for an answer value — 'yes' → its option label, for instance */
function valueLabel(screen: Screen | undefined, value: unknown): string {
  const raw = String(value);
  if (!screen) return raw;
  if (screen.type === 'single' || screen.type === 'multi') {
    return screen.options.find((o) => o.id === raw)?.label || raw;
  }
  if (screen.type === 'consent') {
    if (raw === 'agreed') return screen.agreeLabel;
    if (raw === 'declined') return screen.declineLabel;
  }
  if (screen.type === 'matrix') {
    return screen.items.find((i) => i.id === raw)?.label || raw;
  }
  return raw;
}

function values(screen: Screen | undefined, value: unknown): string {
  return Array.isArray(value)
    ? value.map((v) => valueLabel(screen, v)).join(' / ')
    : valueLabel(screen, value);
}

const NUMERIC_OPS: Record<string, string> = {
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
};

/**
 * "every answer except X" — listing what is left ("no / don't know") reads far
 * better than writing the negation ("not yes").
 */
function complement(screen: Screen | undefined, value: unknown): string | null {
  if (!screen || (screen.type !== 'single' && screen.type !== 'multi')) return null;
  const excluded = new Set((Array.isArray(value) ? value : [value]).map(String));
  const rest = screen.options.filter((o) => !excluded.has(o.id));
  if (rest.length === 0 || rest.length > 3) return null;
  return rest.map((o) => o.label).join(' / ');
}

/**
 * Describing a condition in readable Hebrew, for the edge label. Session
 * variables go through varMeta — "segment: A" on an edge in the diagram is
 * exactly the kind of thing a non-technical admin cannot decode.
 */
export function describeCondition(cond: Condition, screens: Screen[], meta: VarMetaMap = {}): string {
  if ('all' in cond) return cond.all.map((c) => describeCondition(c, screens, meta)).join(' וגם ');
  if ('any' in cond) return cond.any.map((c) => describeCondition(c, screens, meta)).join(' או ');
  if ('not' in cond) {
    // The negation of a simple comparison is translated to ne, which reads better
    const inner = cond.not;
    if ('q' in inner && (inner.op === 'eq' || inner.op === 'in')) {
      return describeCondition({ q: inner.q, op: 'ne', value: inner.value }, screens, meta);
    }
    return `לא ${describeCondition(inner, screens, meta)}`;
  }

  const isQ = 'q' in cond;
  const ref = isQ ? cond.q : cond.var;
  const screen = isQ ? screens.find((s) => s.id === ref) : undefined;
  const subject = isQ ? '' : varName(meta, ref);

  if (cond.op === 'answered') return isQ ? 'יש תשובה' : `${subject} נקבע`;
  if (cond.op in NUMERIC_OPS) return `${isQ ? '' : subject + ' '}${NUMERIC_OPS[cond.op]} ${cond.value}`;

  const v = isQ
    ? values(screen, cond.value)
    : Array.isArray(cond.value)
      ? cond.value.map((x) => varValue(meta, ref, x)).join(' / ')
      : varValue(meta, ref, cond.value);
  switch (cond.op) {
    case 'eq':
    case 'in': {
      if (isQ) return v;
      // A value with a display name ("has or had a mortgage") speaks for itself —
      // the mark's name as a prefix only adds weight. A raw code with no name does
      // still get the prefix, for context.
      const vals = Array.isArray(cond.value) ? cond.value : [cond.value];
      const allNamed = vals.every((x) => meta[ref]?.values?.[String(x)] !== undefined);
      return allNamed ? v : `${subject}: ${v}`;
    }
    case 'ne':
      return isQ ? (complement(screen, cond.value) ?? `≠ ${v}`) : `${subject} ≠ ${v}`;
    case 'includes':
    case 'includesAny':
      return `כולל ${v}`;
    default:
      return v;
  }
}

/** The text that represents the screen in its node */
export function nodeText(screen: Screen): string {
  switch (screen.type) {
    case 'info':
    case 'consent':
    case 'end':
      return screen.title;
    default:
      return screen.prompt;
  }
}

export function buildFlow(config: SurveyConfig): Flow {
  const screens = config.screens ?? [];
  const meta = config.varMeta ?? {};
  const known = new Set(screens.map((s) => s.id));
  const nodes: FlowNode[] = screens.map((screen) => ({
    id: screen.id,
    screen,
    text: nodeText(screen),
  }));
  const edges: FlowEdge[] = [];

  // The quota route the engine draws for itself (see findNext). Derived from the
  // same rule the validator uses, so the diagram and the validation panel cannot
  // tell two different stories about the same screen.
  const quotaFull = screens.find((s) => s.type === 'end' && s.variant === 'quotafull');
  const capped = new Set(quotaCells(config).map((cell) => `${cell.mark} ${cell.value}`));

  screens.forEach((screen, i) => {
    if (screen.type === 'end') return;

    // Emitted before the rules below and regardless of them: a full cap overrides
    // an ordinary goto, so this edge exists even on a screen that already routes
    // somewhere unconditionally.
    if (quotaFull) {
      const fills = (screen.onSubmit ?? []).find((r) => capped.has(`${r.var} ${String(r.value)}`));
      if (fills) {
        const name = meta[fills.var]?.values?.[String(fills.value)] ?? String(fills.value);
        edges.push({
          from: screen.id,
          to: quotaFull.id,
          label: `המכסה של ${name} מלאה`,
          conditional: true,
          kind: 'quota',
        });
      }
    }

    const rules = screen.next ?? [];
    let unconditional = false;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      if (known.has(rule.goto)) {
        edges.push({
          from: screen.id,
          to: rule.goto,
          label: rule.if ? describeCondition(rule.if, screens, meta) : 'תמיד',
          conditional: Boolean(rule.if),
          kind: 'goto',
          ruleIndex: r,
        });
      }
      if (!rule.if) {
        unconditional = true;
        break;
      }
    }
    if (unconditional) return;

    // Fall-through: the engine scans the screens that follow and stops at the
    // first one that passes its showIf. fallThroughTargets returns exactly the
    // possible landings — with no lanes that contradict the source's condition
    // and no duplicates within a lane. The first is the ordinary continuation;
    // the rest are drawn dimmed, to stay readable without hiding real paths.
    fallThroughTargets(screens, i).forEach((target, k) => {
      // Within a lane: a transition between two screens carrying exactly the same
      // condition is certain — a "the respondent's track is X" label on every
      // internal edge of a lane is noise, not information.
      const sameLane =
        target.showIf !== undefined &&
        JSON.stringify(target.showIf) === JSON.stringify(screen.showIf);
      edges.push({
        from: screen.id,
        to: target.id,
        label: sameLane
          ? ''
          : target.showIf
            ? describeCondition(target.showIf, screens, meta)
            : rules.length > 0 || k > 0
              ? 'אחרת' // הענף האחרון של פיצול — גם כשהפיצול נובע מ-showIf בלבד
              : '',
        conditional: !sameLane && (Boolean(target.showIf) || rules.length > 0 || k > 0),
        kind: k === 0 ? 'primary' : 'skip',
      });
    });
  });

  return { nodes, edges };
}
