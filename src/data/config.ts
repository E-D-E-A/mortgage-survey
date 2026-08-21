// Loading the survey config at run time, with the version pinned to the session:
// publishing a new version never affects a respondent who is mid-survey — their
// session carries on with the version it started in (a snapshot in
// sessionStorage, and if that is lost, a fetch by version). Only a new session
// gets the latest active version.
//
// The survey is selected by the slug in the path, and `/s/<slug>` is the only
// shape that resolves to one. The storage keys carry the slug
// (session-scope.ts), so two surveys in the same tab do not overwrite each
// other's session.
//
// In development (vite dev) there is no dependency on Supabase — the local demo
// survey is loaded instead.

import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';
import { scopedKey } from './session-scope';

const ENDPOINT = '/.netlify/functions/config-get';
const STATE_KEY = 'sq_state_v1';
const CONFIG_KEY = 'sq_config_v1';

interface ConfigSnapshot {
  survey: string;
  version: string;
  config: SurveyConfig;
}

/** Why the load failed — 'closed'/'missing' are legitimate states that need explaining to the respondent. */
export type LoadFailure = 'closed' | 'missing' | 'network';

export class ConfigLoadError extends Error {
  constructor(readonly kind: LoadFailure) {
    super(`config load failed: ${kind}`);
  }
}

/** The version the current session is pinned to, if a saved session exists. */
export function pinnedVersion(): string | null {
  try {
    const raw = sessionStorage.getItem(scopedKey(STATE_KEY));
    if (!raw) return null;
    const saved = JSON.parse(raw) as { version?: unknown };
    return typeof saved.version === 'string' ? saved.version : null;
  } catch {
    return null;
  }
}

function readSnapshot(): ConfigSnapshot | null {
  try {
    const raw = sessionStorage.getItem(scopedKey(CONFIG_KEY));
    if (!raw) return null;
    const snap = JSON.parse(raw) as ConfigSnapshot;
    if (typeof snap.version !== 'string' || !Array.isArray(snap.config?.screens)) return null;
    return snap;
  } catch {
    return null;
  }
}

function writeSnapshot(snap: ConfigSnapshot): void {
  try {
    sessionStorage.setItem(scopedKey(CONFIG_KEY), JSON.stringify(snap));
  } catch {
    /* Storage quota full — we will fall back to fetching by version next load */
  }
}

async function fetchConfig(slug: string, version: string | null): Promise<ConfigSnapshot | null> {
  const query = version
    ? `version=${encodeURIComponent(version)}`
    : `survey=${encodeURIComponent(slug)}`;
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${query}`);
  } catch {
    throw new ConfigLoadError('network');
  }
  if (res.status === 404) return null;
  if (res.status === 410) throw new ConfigLoadError('closed');
  if (!res.ok) throw new ConfigLoadError('network');
  const data = (await res.json()) as ConfigSnapshot;
  if (typeof data.version !== 'string' || !Array.isArray(data.config?.screens)) {
    throw new ConfigLoadError('network');
  }
  return data;
}

// The slug is required: a caller that omitted it used to get the main survey
// silently, which is the same implicit-default trap resolveRoute removed from
// the URL side.
export async function loadConfig(slug: string): Promise<SurveyConfig> {
  if (!import.meta.env.PROD) return questionnaire;

  const pinned = pinnedVersion();
  if (pinned) {
    const snap = readSnapshot();
    if (snap && snap.version === pinned) return snap.config;
    const fetched = await fetchConfig(slug, pinned);
    if (fetched) {
      writeSnapshot(fetched);
      return fetched.config;
    }
    // The pinned version is gone (should not happen — the table is immutable): reset the session
    sessionStorage.removeItem(scopedKey(STATE_KEY));
  }

  const active = await fetchConfig(slug, null);
  if (!active) throw new ConfigLoadError('missing');
  writeSnapshot(active);
  return active.config;
}
