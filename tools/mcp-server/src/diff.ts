// A structured diff between the current draft and a proposed config — the
// heart of the propose→confirm→apply flow. The human confirms what they can
// read, so condition changes are rendered as the same Hebrew sentences the
// console shows (conditionSentence), never as raw JSON.

import {
  makeNaming,
  optionalConditionSentence,
  screenLabel,
  squash,
  type Naming,
} from '../../../src/admin/display';
import type { Screen, SurveyConfig } from '../../../src/engine/types';

export interface ScreenChange {
  id: string;
  label: string;
  /** Human-readable Hebrew descriptions of what changed on this screen */
  changes: string[];
}

export interface ConfigDiff {
  screens_added: { id: string; label: string }[];
  screens_removed: { id: string; label: string }[];
  screens_modified: ScreenChange[];
  screens_reordered: boolean;
  random_vars_added: string[];
  random_vars_removed: string[];
  random_vars_changed: { name: string; before: (string | number)[]; after: (string | number)[] }[];
  /** varMeta changes: labels, value labels, quotas — as Hebrew sentences */
  meta_changes: string[];
  /** True when the two configs are identical */
  empty: boolean;
}

const stable = (v: unknown): string => JSON.stringify(v);

function conditionChange(
  naming: Naming,
  what: string,
  before: Parameters<typeof optionalConditionSentence>[1],
  after: Parameters<typeof optionalConditionSentence>[1],
): string {
  return `${what}: "${optionalConditionSentence(naming, before)}" ← "${optionalConditionSentence(naming, after)}"`;
}

/** What changed on one screen, as sentences the admin can confirm. */
function screenChanges(naming: Naming, before: Screen, after: Screen): string[] {
  const changes: string[] = [];
  if (before.type !== after.type) changes.push(`סוג המסך השתנה: ${before.type} ← ${after.type}`);
  if (stable(before.showIf) !== stable(after.showIf)) {
    changes.push(conditionChange(naming, 'תנאי הצגה', before.showIf, after.showIf));
  }
  if (stable(before.next) !== stable(after.next)) {
    const render = (s: Screen): string =>
      (s.next ?? [])
        .map((r) => `אם ${optionalConditionSentence(naming, r.if)} ← ${r.goto}`)
        .join('; ') || 'אין';
    changes.push(`כללי ניתוב: "${render(before)}" ← "${render(after)}"`);
  }
  if (stable(before.onSubmit) !== stable(after.onSubmit)) {
    const render = (s: Screen): string =>
      (s.onSubmit ?? [])
        .map(
          (r) =>
            `${r.var}=${String(r.value)}${r.if ? ` אם ${optionalConditionSentence(naming, r.if)}` : ''}`,
        )
        .join('; ') || 'אין';
    changes.push(`כללי סימון: "${render(before)}" ← "${render(after)}"`);
  }

  // Everything else (wording, options, scales…) — name the fields rather than
  // diffing prose word by word; the admin re-reads the field either way.
  const structural = new Set(['showIf', 'next', 'onSubmit', 'type', 'id']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedFields: string[] = [];
  for (const key of keys) {
    if (structural.has(key)) continue;
    if (
      stable((before as unknown as Record<string, unknown>)[key]) !==
      stable((after as unknown as Record<string, unknown>)[key])
    ) {
      changedFields.push(key);
    }
  }
  if (changedFields.length > 0) changes.push(`שדות תוכן שהשתנו: ${changedFields.join(', ')}`);
  return changes;
}

export function diffConfigs(before: SurveyConfig | null, after: SurveyConfig): ConfigDiff {
  const prev = before ?? { version: 'draft', screens: [] };
  // Sentences are rendered with the NEW config's naming — that is the state
  // the human is being asked to confirm.
  const naming = makeNaming(after);

  const beforeById = new Map(prev.screens.map((s) => [s.id, s]));
  const afterById = new Map(after.screens.map((s) => [s.id, s]));

  const added = after.screens
    .filter((s) => !beforeById.has(s.id))
    .map((s) => ({ id: s.id, label: screenLabel(s) }));
  const removed = prev.screens
    .filter((s) => !afterById.has(s.id))
    .map((s) => ({ id: s.id, label: screenLabel(s) }));

  const modified: ScreenChange[] = [];
  for (const screen of after.screens) {
    const old = beforeById.get(screen.id);
    if (!old || stable(old) === stable(screen)) continue;
    modified.push({ id: screen.id, label: screenLabel(screen), changes: screenChanges(naming, old, screen) });
  }

  const sharedOrderBefore = prev.screens.map((s) => s.id).filter((id) => afterById.has(id));
  const sharedOrderAfter = after.screens.map((s) => s.id).filter((id) => beforeById.has(id));
  const reordered = stable(sharedOrderBefore) !== stable(sharedOrderAfter);

  const drawsBefore = prev.randomVars ?? {};
  const drawsAfter = after.randomVars ?? {};
  const drawNames = new Set([...Object.keys(drawsBefore), ...Object.keys(drawsAfter)]);
  const varsAdded: string[] = [];
  const varsRemoved: string[] = [];
  const varsChanged: ConfigDiff['random_vars_changed'] = [];
  for (const name of drawNames) {
    if (!(name in drawsBefore)) varsAdded.push(name);
    else if (!(name in drawsAfter)) varsRemoved.push(name);
    else if (stable(drawsBefore[name]) !== stable(drawsAfter[name])) {
      varsChanged.push({ name, before: drawsBefore[name], after: drawsAfter[name] });
    }
  }

  const metaChanges: string[] = [];
  const metaBefore = prev.varMeta ?? {};
  const metaAfter = after.varMeta ?? {};
  for (const name of new Set([...Object.keys(metaBefore), ...Object.keys(metaAfter)])) {
    const b = metaBefore[name];
    const a = metaAfter[name];
    // squash: labels are free text; one line each, no matter what is in them
    if (!b) {
      metaChanges.push(`נוסף סימון "${squash(a.label)}" [${name}]`);
      continue;
    }
    if (!a) {
      metaChanges.push(`הוסר סימון "${squash(b.label)}" [${name}]`);
      continue;
    }
    if (b.label !== a.label) {
      metaChanges.push(`תווית ${name}: "${squash(b.label)}" ← "${squash(a.label)}"`);
    }
    if (stable(b.values) !== stable(a.values)) {
      metaChanges.push(`תוויות הערכים של ${name} השתנו`);
    }
    if (stable(b.quotas) !== stable(a.quotas)) {
      const cells = new Set([...Object.keys(b.quotas ?? {}), ...Object.keys(a.quotas ?? {})]);
      for (const value of cells) {
        const qb = b.quotas?.[value];
        const qa = a.quotas?.[value];
        if (qb === qa) continue;
        const wasnt = 'ללא מכסה';
        metaChanges.push(`מכסה ${name}=${value}: ${qb ?? wasnt} ← ${qa ?? wasnt}`);
      }
    }
  }

  const empty =
    added.length === 0 &&
    removed.length === 0 &&
    modified.length === 0 &&
    !reordered &&
    varsAdded.length === 0 &&
    varsRemoved.length === 0 &&
    varsChanged.length === 0 &&
    metaChanges.length === 0;

  return {
    screens_added: added,
    screens_removed: removed,
    screens_modified: modified,
    screens_reordered: reordered,
    random_vars_added: varsAdded,
    random_vars_removed: varsRemoved,
    random_vars_changed: varsChanged,
    meta_changes: metaChanges,
    empty,
  };
}

/** The diff as indented Hebrew text — what the model shows the human for confirmation. */
export function renderDiff(diff: ConfigDiff): string {
  if (diff.empty) return 'אין הבדל בין ההצעה לטיוטה הנוכחית.';
  const lines: string[] = [];
  if (diff.screens_added.length > 0) {
    lines.push('מסכים שנוספו:');
    for (const s of diff.screens_added) lines.push(`+ [${s.id}] ${s.label}`);
  }
  if (diff.screens_removed.length > 0) {
    lines.push('מסכים שהוסרו:');
    for (const s of diff.screens_removed) lines.push(`- [${s.id}] ${s.label}`);
  }
  if (diff.screens_modified.length > 0) {
    lines.push('מסכים ששונו:');
    for (const s of diff.screens_modified) {
      lines.push(`~ [${s.id}] ${s.label}`);
      for (const c of s.changes) lines.push(`    ${c}`);
    }
  }
  if (diff.screens_reordered) lines.push('סדר המסכים השתנה.');
  for (const name of diff.random_vars_added) lines.push(`+ הגרלה חדשה: ${name}`);
  for (const name of diff.random_vars_removed) lines.push(`- הגרלה הוסרה: ${name}`);
  for (const change of diff.random_vars_changed) {
    lines.push(
      `~ ערכי ההגרלה ${change.name}: ${change.before.map(String).join('/')} ← ${change.after.map(String).join('/')}`,
    );
  }
  for (const line of diff.meta_changes) lines.push(`~ ${line}`);
  return lines.join('\n');
}
