// Survey-level edits to the session variables, as pure functions: defining a
// mark, defining a value, creating and deleting a draw and editing its value
// list — plus finding everything that still points at a variable, before it is
// deleted.
//
// Pure and React-free, for the same reason edits.ts exists: this is the logic
// that can and should be unit-tested, which leaves the component above it as
// rendering only.

import {
  interpolatedTexts,
  interpolationRefs,
  mapInterpolatedTexts,
} from '../engine/conditions';
import { screenConditions } from '../engine/validate';
import type { Condition, Screen, SurveyConfig, VarMeta } from '../engine/types';

/** A value in a draw: a number stays a number, so a numeric condition keeps comparing numbers. */
export type RandomValue = string | number;

/** Where a variable is still in use — exactly what deleting it would break. */
export interface VarReference {
  screenId: string;
  /** 'condition' — showIf / a routing rule / a marking rule; 'text' — `{name}` interpolation in the wording */
  kind: 'condition' | 'text';
}

/**
 * `"79"` → 79, everything else stays text. The draw feeds conditions, and a price
 * stored as a string will never pass a "greater than 100" test — with nothing in
 * the console to hint at why.
 */
export function parseRandomValue(raw: string): RandomValue {
  const trimmed = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/** A new mark is recorded at survey level (varMeta), so every screen sees it by its name. */
export function defineVar(config: SurveyConfig, name: string, label: string): SurveyConfig {
  return {
    ...config,
    varMeta: { ...config.varMeta, [name]: { ...config.varMeta?.[name], label } },
  };
}

/**
 * ⚠ `...existing` and not a fresh object: VarMeta carries the quotas too, and
 * rebuilding it from label+values alone dropped every quota on the mark the
 * moment a value was named. Nothing complained afterwards — with no quotas left
 * there is nothing for the validator to check — so the survey published with the
 * cap quietly gone.
 */
export function defineVarValue(
  config: SurveyConfig,
  name: string,
  value: string,
  label: string,
): SurveyConfig {
  const existing = config.varMeta?.[name];
  return {
    ...config,
    varMeta: {
      ...config.varMeta,
      [name]: {
        ...existing,
        label: existing?.label ?? name,
        values: { ...existing?.values, [value]: label },
      },
    },
  };
}

/**
 * An emptied label is deleted rather than stored as an empty string:
 * varValueLabel falls back to the id only when there is no label at all, so a
 * stored empty label would render the value as a blank line everywhere the
 * console mentions it.
 */
export function setVarValueLabel(
  config: SurveyConfig,
  name: string,
  value: string,
  label: string,
): SurveyConfig {
  if (label.trim()) return defineVarValue(config, name, value, label);
  return moveValueLabel(config, name, value, null);
}

/**
 * A new draw is born with one empty slot: somewhere to type immediately, and the
 * card's own hint asks for the second.
 *
 * Two empty slots was the first attempt, and it was worse in three ways at once:
 * two identical values trip the duplicate warning, both rows key their label off
 * the same empty string (so typing a name into one showed it in the other), and a
 * variable one click old opened with three complaints against it.
 */
export function addRandomVar(config: SurveyConfig, name: string, label: string): SurveyConfig {
  return defineVar({ ...config, randomVars: { ...config.randomVars, [name]: [''] } }, name, label);
}

function withValues(config: SurveyConfig, name: string, values: RandomValue[]): SurveyConfig {
  return { ...config, randomVars: { ...config.randomVars, [name]: values } };
}

export function addRandomValue(config: SurveyConfig, name: string): SurveyConfig {
  return withValues(config, name, [...(config.randomVars?.[name] ?? []), '']);
}

/**
 * Editing a value in place drags its label along. The label is keyed by the
 * value, so leaving it behind does not merely lose the name the admin just
 * wrote — it attaches that name to whatever value is typed there next.
 *
 * The label belongs to the *value*, though, and not to the row — which is what
 * the two guards below are about. A label is only carried off the old value when
 * no other row still holds it, and only onto the new value when that value has
 * no name of its own; otherwise editing one row into another row's value would
 * silently rename that other row, with the winner decided by nothing more
 * meaningful than key insertion order.
 */
export function setRandomValueAt(
  config: SurveyConfig,
  name: string,
  index: number,
  value: RandomValue,
): SurveyConfig {
  const values = [...(config.randomVars?.[name] ?? [])];
  if (index < 0 || index >= values.length) return config;
  const previous = String(values[index]);
  values[index] = value;
  const next = withValues(config, name, values);

  if (values.some((v, i) => i !== index && String(v) === previous)) return next;
  const target = next.varMeta?.[name]?.values?.[String(value)] === undefined ? String(value) : null;
  return moveValueLabel(next, name, previous, target);
}

export function removeRandomValueAt(config: SurveyConfig, name: string, index: number): SurveyConfig {
  const values = [...(config.randomVars?.[name] ?? [])];
  if (index < 0 || index >= values.length) return config;
  const [dropped] = values.splice(index, 1);
  const next = withValues(config, name, values);
  // The label is dropped only when no other slot carries the same value (a list with a duplicate)
  if (values.some((v) => String(v) === String(dropped))) return next;
  return moveValueLabel(next, name, String(dropped), null);
}

/** Moves a value's label from one key to another; a null target deletes it. */
function moveValueLabel(
  config: SurveyConfig,
  name: string,
  from: string,
  to: string | null,
): SurveyConfig {
  const meta = config.varMeta?.[name];
  if (!meta?.values || !(from in meta.values) || from === to) return config;
  const values: Record<string, string> = {};
  for (const [key, label] of Object.entries(meta.values)) {
    if (key === from) {
      if (to !== null) values[to] = label;
    } else {
      values[key] = label;
    }
  }
  return { ...config, varMeta: { ...config.varMeta, [name]: { ...meta, values } } };
}

/**
 * Deleting a draw deletes its labels too. An orphaned label does the engine no
 * harm, but it does come back: the next code created under that name would
 * inherit the display name of something else entirely.
 */
export function removeRandomVar(config: SurveyConfig, name: string): SurveyConfig {
  const { [name]: _values, ...randomVars } = config.randomVars ?? {};
  const { [name]: _meta, ...varMeta } = config.varMeta ?? {};
  const next: SurveyConfig = { ...config };
  if (Object.keys(randomVars).length > 0) next.randomVars = randomVars;
  else delete next.randomVars;
  if (Object.keys(varMeta).length > 0) next.varMeta = varMeta;
  else delete next.varMeta;
  return next;
}

/** A mark together with every value known for it — the basis for editing quotas. */
export interface Mark {
  name: string;
  /** From varMeta first (the order the admin chose), then values only the onSubmit rules know about */
  values: string[];
}

/**
 * The marks the screens set — as opposed to draws (settled on entry) and URL
 * parameters. The values are gathered from two sources deliberately: varMeta
 * holds what was defined in the console, but a hand-written config can set a
 * value that never got a label — and a quota you cannot type for it is exactly
 * the case where the admin will believe one exists.
 */
export function marks(config: SurveyConfig): Mark[] {
  const drawn = new Set(Object.keys(config.randomVars ?? {}));
  const found = new Map<string, string[]>();

  const add = (name: string, value?: string) => {
    if (drawn.has(name) || name.startsWith('url_')) return;
    const values = found.get(name) ?? [];
    if (value !== undefined && !values.includes(value)) values.push(value);
    found.set(name, values);
  };

  for (const [name, meta] of Object.entries(config.varMeta ?? {})) {
    add(name);
    for (const value of Object.keys(meta.values ?? {})) add(name, value);
  }
  for (const screen of config.screens) {
    for (const rule of screen.onSubmit ?? []) add(rule.var, String(rule.value));
  }
  return [...found].map(([name, values]) => ({ name, values }));
}

/**
 * An emptied quota is deleted rather than stored as 0: the absence of an entry is
 * "unlimited", and every number in the map is a real quota — including 0, which
 * means a cell that is closed and takes no more respondents.
 */
export function setQuota(
  config: SurveyConfig,
  name: string,
  value: string,
  limit: number | undefined,
): SurveyConfig {
  const meta = config.varMeta?.[name];
  const quotas = { ...meta?.quotas };
  if (limit === undefined) delete quotas[value];
  else quotas[value] = limit;

  const { quotas: _dropped, ...rest } = { ...meta, label: meta?.label ?? name };
  const next: VarMeta =
    Object.keys(quotas).length > 0 ? { ...rest, quotas } : rest;
  return { ...config, varMeta: { ...config.varMeta, [name]: next } };
}

/* ---------- renaming a code ---------- */
//
// A code locks after the first publish, but until then it is open — and changing
// it then has to drag *every* reference along in one go. A code that changed in
// one place and not another leaves a survey that looks fine and behaves
// differently: a condition that stops matching, a quota that stops counting, an
// interpolation that prints its braces. So it all lives in one function, rather
// than a set of edits the caller has to assemble.

/** Renames a key in a map without changing the key order (the order is what the admin sees). */
function renameKey<T>(
  map: Record<string, T> | undefined,
  from: string,
  to: string,
): Record<string, T> | undefined {
  if (!map || !(from in map)) return map;
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) out[key === from ? to : key] = value;
  return out;
}

/** Applies a transformation to all of a screen's conditions — showIf, routing rules and marking rules. */
function mapScreenConditions(screen: Screen, fn: (cond: Condition) => Condition): Screen {
  const next: Screen = { ...screen };
  if (next.showIf) next.showIf = fn(next.showIf);
  if (next.next) next.next = next.next.map((r) => (r.if ? { ...r, if: fn(r.if) } : r));
  if (next.onSubmit) next.onSubmit = next.onSubmit.map((r) => (r.if ? { ...r, if: fn(r.if) } : r));
  return next;
}

function mapLeaves(cond: Condition, fn: (leaf: Condition) => Condition): Condition {
  if ('all' in cond) return { all: cond.all.map((c) => mapLeaves(c, fn)) };
  if ('any' in cond) return { any: cond.any.map((c) => mapLeaves(c, fn)) };
  if ('not' in cond) return { not: mapLeaves(cond.not, fn) };
  return fn(cond);
}

/**
 * Renaming a mark's or a draw's code, along with every reference to it: marking
 * rules, conditions, labels, quotas, the draw's value list and `{name}`
 * interpolation in the screen text.
 *
 * ⚠ Assumes the new code is free — that check happens in the form
 * (DefineForm.takenCodes), because there it can explain the problem to the admin
 * before they click.
 */
export function renameVar(config: SurveyConfig, from: string, to: string): SurveyConfig {
  if (from === to) return config;

  const screens = config.screens.map((screen) => {
    let next = mapScreenConditions(screen, (cond) =>
      mapLeaves(cond, (leaf) => ('var' in leaf && leaf.var === from ? { ...leaf, var: to } : leaf)),
    );
    if (next.onSubmit?.some((r) => r.var === from)) {
      next = { ...next, onSubmit: next.onSubmit.map((r) => (r.var === from ? { ...r, var: to } : r)) };
    }
    // split/join and not a regex: the code comes from a form rather than from our
    // own source, and there is no reason to run it through an engine that
    // interprets characters
    return mapInterpolatedTexts(next, (text) => text.split(`{${from}}`).join(`{${to}}`));
  });

  const next: SurveyConfig = { ...config, screens };
  const varMeta = renameKey(config.varMeta, from, to);
  const randomVars = renameKey(config.randomVars, from, to);
  if (varMeta) next.varMeta = varMeta;
  if (randomVars) next.randomVars = randomVars;
  return next;
}

/**
 * Renaming the code of a mark *value*, along with every reference to it: the
 * value in the marking rules, the values in conditions (including inside "one
 * of these" lists), the label and the quota.
 *
 * The comparison runs on String(value) because a value may be stored as a number
 * (a draw) while the code the form hands back is always a string.
 */
export function renameVarValue(
  config: SurveyConfig,
  mark: string,
  from: string,
  to: string,
): SurveyConfig {
  if (from === to) return config;
  const swap = (value: unknown) => (String(value) === from ? to : value);

  const screens = config.screens.map((screen) => {
    let next = mapScreenConditions(screen, (cond) =>
      mapLeaves(cond, (leaf) => {
        if (!('var' in leaf) || leaf.var !== mark || leaf.value === undefined) return leaf;
        return Array.isArray(leaf.value)
          ? { ...leaf, value: leaf.value.map(swap) }
          : { ...leaf, value: swap(leaf.value) };
      }),
    );
    if (next.onSubmit?.some((r) => r.var === mark && String(r.value) === from)) {
      next = {
        ...next,
        onSubmit: next.onSubmit.map((r) =>
          r.var === mark && String(r.value) === from ? { ...r, value: to } : r,
        ),
      };
    }
    return next;
  });

  const meta = config.varMeta?.[mark];
  const nextConfig: SurveyConfig = { ...config, screens };
  if (meta) {
    const values = renameKey(meta.values, from, to);
    const quotas = renameKey(meta.quotas, from, to);
    nextConfig.varMeta = {
      ...config.varMeta,
      [mark]: { ...meta, ...(values && { values }), ...(quotas && { quotas }) },
    };
  }
  const drawn = config.randomVars?.[mark];
  if (drawn) {
    nextConfig.randomVars = {
      ...config.randomVars,
      [mark]: drawn.map((v) => (String(v) === from ? parseRandomValue(to) : v)),
    };
  }
  return nextConfig;
}

function conditionUsesVar(cond: Condition, name: string): boolean {
  if ('all' in cond) return cond.all.some((c) => conditionUsesVar(c, name));
  if ('any' in cond) return cond.any.some((c) => conditionUsesVar(c, name));
  if ('not' in cond) return conditionUsesVar(cond.not, name);
  return 'var' in cond && cond.var === name;
}

/**
 * Everything that would break if the variable disappeared. Validation catches it
 * after the deletion too (a reference that no longer exists, an interpolation
 * that cannot resolve) — but by then the survey is already broken, and the admin
 * needs to understand what they are about to do *before* they click.
 */
export function varReferences(config: SurveyConfig, name: string): VarReference[] {
  const refs: VarReference[] = [];
  for (const screen of config.screens) {
    if (screenConditions(screen).some((c) => conditionUsesVar(c, name))) {
      refs.push({ screenId: screen.id, kind: 'condition' });
    }
    const inText = interpolatedTexts(screen).some(
      (text) => typeof text === 'string' && interpolationRefs(text).includes(name),
    );
    if (inText) refs.push({ screenId: screen.id, kind: 'text' });
  }
  return refs;
}
