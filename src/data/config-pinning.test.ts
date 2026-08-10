// @vitest-environment jsdom
//
// איזה קונפיג הדפדפן טוען. שתי הבטחות שהמערכת נותנת לעורך ולמשיב:
//   1. משיב חדש מקבל את הגרסה הפעילה האחרונה של השאלון שבקישור;
//   2. משיב שהתחיל **נשאר בגרסה שלו** — פרסום באמצע לא מחליף לו את השאלון.
// בלי (2), פרסום בזמן פיילוט מערבב שתי גרסאות שאלון באותו סשן, והנתונים
// אינם ניתנים לפירוש.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SurveyConfig } from '../engine/types';
import { scopedKey, setSurveyScope } from './session-scope';

let loadConfig: typeof import('./config').loadConfig;
let ConfigLoadError: typeof import('./config').ConfigLoadError;

const STATE_KEY = 'sq_state_v1';
const CONFIG_KEY = 'sq_config_v1';

const configV1: SurveyConfig = {
  version: 'ignored — the server decides',
  screens: [
    { id: 'intro', type: 'info', title: 'גרסה ראשונה', body: '' },
    { id: 'end_complete', type: 'end', variant: 'complete', title: 'סוף', body: '' },
  ],
};
const configV2: SurveyConfig = {
  ...configV1,
  screens: [
    { id: 'intro', type: 'info', title: 'גרסה שנייה', body: '' },
    configV1.screens[1],
  ],
};

interface Reply {
  status?: number;
  body?: unknown;
}

let replies: Reply[] = [];
let requested: string[] = [];

beforeAll(async () => {
  vi.stubEnv('PROD', true);
  globalThis.fetch = vi.fn(async (url: unknown) => {
    requested.push(String(url));
    const reply = replies.shift() ?? { status: 500 };
    if (reply.status === 0) throw new TypeError('network down');
    const status = reply.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
  const mod = await import('./config');
  loadConfig = mod.loadConfig;
  ConfigLoadError = mod.ConfigLoadError;
});

beforeEach(() => {
  replies = [];
  requested = [];
  sessionStorage.clear();
  setSurveyScope('main');
});

afterEach(() => {
  setSurveyScope('main');
});

/** סשן שכבר התחיל: המצב השמור נושא את הגרסה שאליה הוא מוצמד. */
function startedAt(version: string) {
  sessionStorage.setItem(scopedKey(STATE_KEY), JSON.stringify({ version, current: 'intro' }));
}

describe('a new session gets the active version', () => {
  it('asks for the survey by slug and keeps a snapshot for the next page load', async () => {
    replies = [{ body: { survey: 'main', version: '2026-08-09.2-main', config: configV2 } }];
    const config = await loadConfig('main');
    expect(config).toEqual(configV2);
    expect(requested[0]).toContain('survey=main');
    expect(requested[0]).not.toContain('version=');
    expect(JSON.parse(sessionStorage.getItem(scopedKey(CONFIG_KEY))!).version).toBe(
      '2026-08-09.2-main',
    );
  });

  it('asks for the survey in the link, not the default one', async () => {
    setSurveyScope('pilot-2');
    replies = [{ body: { survey: 'pilot-2', version: 'v9', config: configV1 } }];
    await loadConfig('pilot-2');
    expect(requested[0]).toContain('survey=pilot-2');
    // המפתחות מוגבלים לשאלון — שני שאלונים באותה לשונית לא דורסים זה את זה
    expect(sessionStorage.getItem('sq_config_v1:pilot-2')).not.toBeNull();
    expect(sessionStorage.getItem('sq_config_v1')).toBeNull();
  });
});

describe('a session in progress keeps the version it started with', () => {
  it('asks for its own version, even after a newer one was published', async () => {
    startedAt('2026-08-01.1-main');
    replies = [{ body: { survey: 'main', version: '2026-08-01.1-main', config: configV1 } }];
    const config = await loadConfig('main');
    expect(config).toEqual(configV1);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('version=2026-08-01.1-main');
    expect(requested[0]).not.toContain('survey=');
  });

  it('uses the local snapshot without any request at all', async () => {
    startedAt('2026-08-01.1-main');
    sessionStorage.setItem(
      scopedKey(CONFIG_KEY),
      JSON.stringify({ survey: 'main', version: '2026-08-01.1-main', config: configV1 }),
    );
    expect(await loadConfig('main')).toEqual(configV1);
    expect(requested).toHaveLength(0);
  });

  it('ignores a snapshot from a different version and refetches the pinned one', async () => {
    startedAt('2026-08-01.1-main');
    sessionStorage.setItem(
      scopedKey(CONFIG_KEY),
      JSON.stringify({ survey: 'main', version: 'something-else', config: configV2 }),
    );
    replies = [{ body: { survey: 'main', version: '2026-08-01.1-main', config: configV1 } }];
    expect(await loadConfig('main')).toEqual(configV1);
    expect(requested[0]).toContain('version=2026-08-01.1-main');
  });

  it('starts over when the pinned version has vanished, rather than mixing versions', async () => {
    startedAt('gone');
    replies = [
      { status: 404 },
      { body: { survey: 'main', version: '2026-08-09.1-main', config: configV2 } },
    ];
    expect(await loadConfig('main')).toEqual(configV2);
    // המצב הישן נמחק — אחרת המשיב היה ממשיך במסך של גרסה שאינה קיימת
    expect(sessionStorage.getItem(scopedKey(STATE_KEY))).toBeNull();
  });
});

describe('failures are explained, not guessed', () => {
  it('an archived survey reports "closed" (410)', async () => {
    replies = [{ status: 410 }];
    await expect(loadConfig('old')).rejects.toMatchObject({ kind: 'closed' });
  });

  it('a survey that was never published reports "missing" (404)', async () => {
    replies = [{ status: 404 }];
    await expect(loadConfig('fresh')).rejects.toMatchObject({ kind: 'missing' });
  });

  it('a dead network reports "network" and never falls back to a demo questionnaire', async () => {
    replies = [{ status: 0 }];
    const error = await loadConfig('main').catch((e) => e);
    expect(error).toBeInstanceOf(ConfigLoadError);
    expect(error.kind).toBe('network');
  });

  it('a reply that is not a questionnaire is refused instead of rendered', async () => {
    replies = [{ body: { survey: 'main', version: 'v1', config: { screens: 'oops' } } }];
    await expect(loadConfig('main')).rejects.toMatchObject({ kind: 'network' });
  });

  it('a server error reports "network" so the respondent is asked to retry', async () => {
    replies = [{ status: 502 }];
    await expect(loadConfig('main')).rejects.toMatchObject({ kind: 'network' });
  });
});
