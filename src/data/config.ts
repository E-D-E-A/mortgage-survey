// טעינת קונפיג השאלון בזמן ריצה, עם הצמדת גרסה לסשן:
// פרסום גרסה חדשה לעולם לא משפיע על משיב באמצע שאלון — הסשן ממשיך עם
// הגרסה שבה התחיל (snapshot ב-sessionStorage, ואם אבד — שליפה לפי version).
// רק סשן חדש מקבל את הגרסה הפעילה האחרונה.
//
// בפיתוח (vite dev) אין תלות ב-Supabase — נטען שאלון הדגמה המקומי.

import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/placeholder';

const ENDPOINT = '/.netlify/functions/config-get';
const STATE_KEY = 'sq_state_v1';
const CONFIG_KEY = 'sq_config_v1';

interface ConfigSnapshot {
  version: string;
  config: SurveyConfig;
}

/** הגרסה שאליה מוצמד הסשן הנוכחי, אם קיים סשן שמור. */
function pinnedVersion(): string | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { version?: unknown };
    return typeof saved.version === 'string' ? saved.version : null;
  } catch {
    return null;
  }
}

function readSnapshot(): ConfigSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
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
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(snap));
  } catch {
    /* מכסה מלאה — נסתמך על שליפה לפי version בטעינה הבאה */
  }
}

async function fetchConfig(version: string | null): Promise<ConfigSnapshot | null> {
  const url = version ? `${ENDPOINT}?version=${encodeURIComponent(version)}` : ENDPOINT;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
  const data = (await res.json()) as ConfigSnapshot;
  if (typeof data.version !== 'string' || !Array.isArray(data.config?.screens)) {
    throw new Error('malformed config');
  }
  return data;
}

export async function loadConfig(): Promise<SurveyConfig> {
  if (!import.meta.env.PROD) return questionnaire;

  const pinned = pinnedVersion();
  if (pinned) {
    const snap = readSnapshot();
    if (snap && snap.version === pinned) return snap.config;
    const fetched = await fetchConfig(pinned);
    if (fetched) {
      writeSnapshot(fetched);
      return fetched.config;
    }
    // הגרסה המוצמדת נעלמה (לא אמור לקרות — הטבלה immutable): איפוס הסשן
    sessionStorage.removeItem(STATE_KEY);
  }

  const active = await fetchConfig(null);
  if (!active) throw new Error('no published config');
  writeSnapshot(active);
  return active.config;
}
