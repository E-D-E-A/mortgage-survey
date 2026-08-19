// A compact, human-readable Hebrew outline of a survey config — screens in
// order, routing and conditions as sentences, draws, marks and quotas.
//
// Two callers, one wording: get_draft hands this to the model instead of a wall
// of JSON, and the console renders a published version with it. That is what
// makes a frozen version readable at all — there is no editor for one, and
// there must not be, so the outline IS the read-only view.

import {
  makeNaming,
  optionalConditionSentence,
  screenKindLabel,
  screenLabel,
  screenRef,
  squash,
  varLabel,
  varValueLabel,
  type Naming,
} from './display';
import { quotaCells } from '../engine/quota';
import type { Screen, SurveyConfig } from '../engine/types';

function screenLines(naming: Naming, screen: Screen, index: number): string[] {
  const lines: string[] = [`${index + 1}. [${screen.id}] ${screenKindLabel(screen)} — ${screenLabel(screen)}`];
  if (screen.showIf) {
    lines.push(`   מוצג אם: ${optionalConditionSentence(naming, screen.showIf)}`);
  }
  for (const rule of screen.next ?? []) {
    const target = screenRef(naming, rule.goto);
    lines.push(
      rule.if
        ? `   ניתוב: אם ${optionalConditionSentence(naming, rule.if)} ← ${target}`
        : `   ניתוב: תמיד ← ${target}`,
    );
  }
  for (const rule of screen.onSubmit ?? []) {
    // squash: labels are admin-authored free text; a newline inside one must
    // not be able to forge extra outline lines
    const value = squash(varValueLabel(naming, rule.var, rule.value));
    const base = `   קובע: ${squash(varLabel(naming, rule.var))} = ${value}`;
    lines.push(rule.if ? `${base} אם ${optionalConditionSentence(naming, rule.if)}` : base);
  }
  return lines;
}

/** The whole config as an indented Hebrew outline: screens, draws, marks and quotas. */
export function buildOutline(config: SurveyConfig): string {
  const naming = makeNaming(config);
  const lines: string[] = [`מסכים (${config.screens.length}):`];
  config.screens.forEach((screen, i) => lines.push(...screenLines(naming, screen, i)));

  const draws = Object.entries(config.randomVars ?? {});
  if (draws.length > 0) {
    lines.push('', 'הגרלות (A/B):');
    for (const [name, values] of draws) {
      lines.push(`- ${squash(varLabel(naming, name))} [${name}]: ${values.map(String).join(' / ')}`);
    }
  }

  const quotas = quotaCells(config);
  const marks = Object.entries(config.varMeta ?? {});
  if (marks.length > 0) {
    lines.push('', 'סימונים (פרסונות):');
    for (const [name, meta] of marks) {
      const values = Object.entries(meta.values ?? {})
        .map(([code, label]) => {
          const quota = meta.quotas?.[code];
          const clean = squash(label);
          return quota === undefined ? `${code}="${clean}"` : `${code}="${clean}" (מכסה ${quota})`;
        })
        .join(', ');
      lines.push(`- ${squash(meta.label)} [${name}]${values ? `: ${values}` : ''}`);
    }
  }
  if (quotas.length > 0) {
    lines.push('', 'מכסות:');
    for (const cell of quotas) {
      lines.push(
        `- ${squash(varLabel(naming, cell.mark))} = ${squash(varValueLabel(naming, cell.mark, cell.value))}: עד ${cell.limit} משיבים`,
      );
    }
  }

  return lines.join('\n');
}
