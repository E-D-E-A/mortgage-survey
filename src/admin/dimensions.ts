// Which dimensions a survey can be broken down by, and which config decides.
//
// Split out of stats.ts so the server can share it. The rule "these dimensions
// and nothing else" is enforced twice — the console draws its menu from it, and
// admin-stats rejects anything outside it — and a rule enforced twice has to come
// from one place or the two copies drift.
//
// ⚠ Nothing here may import from ./api or ./supabaseClient. Those reach the
// Supabase browser client and `import.meta.env`, which the Netlify functions'
// TypeScript build has no types for; importing them here breaks that build.

import type { SurveyConfig } from '../engine/types';

/** A published version, as both the console and the stats endpoint hold it. */
export interface VersionWithConfig {
  version: string;
  config: SurveyConfig;
  /** Carried by both callers' own types; nothing here reads it. */
  published_at?: string;
}

export interface DimensionOption {
  key: string;
  label: string;
}

/** The config that dictates order and labels: the latest under "all versions", or the version selected */
export const chosenConfig = (
  versions: VersionWithConfig[],
  selected: string,
): SurveyConfig | undefined =>
  (selected === 'all' ? versions[0] : versions.find((v) => v.version === selected))?.config;

/**
 * The dimensions offered for a breakdown: varMeta variables (by their labels),
 * randomVars variables (experiment arms), the arrival source url_source, and the
 * session outcome. Deliberately not every url_* (panel ids = one value per
 * person's worth of cardinality).
 */
export function dimensionOptions(
  versions: VersionWithConfig[],
  selected: string,
): DimensionOption[] {
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
