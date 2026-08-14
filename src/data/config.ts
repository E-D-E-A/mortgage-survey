// טעינת קונפיג השאלון בזמן ריצה, עם הצמדת גרסה לסשן:
// פרסום גרסה חדשה לעולם לא משפיע על משיב באמצע שאלון — הסשן ממשיך עם
// הגרסה שבה התחיל (snapshot ב-sessionStorage, ואם אבד — שליפה לפי version).
// רק סשן חדש מקבל את הגרסה הפעילה האחרונה.
//
// השאלון נבחר לפי ה-slug שבנתיב (‎/s/<slug>‎); הנתיב הישן ‎/‎ מגיש את שאלון
// ברירת המחדל. מפתחות האחסון מקבלים את ה-slug (session-scope.ts), ולכן שני
// שאלונים באותה לשונית לא דורסים זה את הסשן של זה.
//
// בפיתוח (vite dev) אין תלות ב-Supabase — נטען שאלון הדגמה המקומי.

import type { SurveyConfig } from '../engine/types';
import { questionnaire } from '../questionnaire/survey-v1';
import { DEFAULT_SURVEY_SLUG } from './surveys';
import { scopedKey } from './session-scope';

const ENDPOINT = '/.netlify/functions/config-get';
const STATE_KEY = 'sq_state_v1';
const CONFIG_KEY = 'sq_config_v1';

interface ConfigSnapshot {
  survey: string;
  version: string;
  config: SurveyConfig;
}

/** למה הטעינה נכשלה — 'closed'/'missing' הם מצבים לגיטימיים שצריך להסביר למשיב. */
export type LoadFailure = 'closed' | 'missing' | 'network';

export class ConfigLoadError extends Error {
  constructor(readonly kind: LoadFailure) {
    super(`config load failed: ${kind}`);
  }
}

/** הגרסה שאליה מוצמד הסשן הנוכחי, אם קיים סשן שמור. */
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
    /* מכסה מלאה — נסתמך על שליפה לפי version בטעינה הבאה */
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

export async function loadConfig(slug: string = DEFAULT_SURVEY_SLUG): Promise<SurveyConfig> {
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
    // הגרסה המוצמדת נעלמה (לא אמור לקרות — הטבלה immutable): איפוס הסשן
    sessionStorage.removeItem(scopedKey(STATE_KEY));
  }

  const active = await fetchConfig(slug, null);
  if (!active) throw new ConfigLoadError('missing');
  writeSnapshot(active);
  return active.config;
}
