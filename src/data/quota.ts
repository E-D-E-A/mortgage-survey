// Fetching the quota state on entry to the survey, and turning it into session vars.
//
// Called once, alongside the config load (AppShell), and only for a new session:
// a respondent who already started carries the flags they got then, and a quota
// that fills mid-survey does not throw them out.
//
// ⚠ Fail open on every failure path — network, server, malformed JSON. A real
// respondent is never blocked by a fault of ours; the price is a few respondents
// over quota, which is exactly the right direction to err in.

import type { QuotaCounts } from '../engine/quota';
import { pinnedVersion } from './config';

const ENDPOINT = '/.netlify/functions/quota-get';

/**
 * The counts from the server, or an empty map. Called in parallel with the
 * config load rather than after it: the request does not depend on it, and
 * running them in series would add a whole network round trip before the first
 * screen. The comparison against the ceilings happens at the caller, against the
 * config pinned to the session.
 */
export async function fetchQuotaCounts(slug: string): Promise<QuotaCounts> {
  // The same boundary as the events layer: in development (vite dev) there are
  // no functions, and nothing to count
  if (!import.meta.env.PROD) return {};
  // An existing session already carries its flags — the request here would delay
  // every mid-survey refresh for an answer that gets thrown away
  if (pinnedVersion()) return {};

  try {
    const res = await fetch(`${ENDPOINT}?survey=${encodeURIComponent(slug)}`);
    if (!res.ok) return {};
    const data = (await res.json()) as { counts?: unknown };
    return isCounts(data.counts) ? data.counts : {};
  } catch {
    return {};
  }
}

function isCounts(value: unknown): value is QuotaCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (byValue) =>
      typeof byValue === 'object' &&
      byValue !== null &&
      !Array.isArray(byValue) &&
      Object.values(byValue).every((n) => typeof n === 'number'),
  );
}
