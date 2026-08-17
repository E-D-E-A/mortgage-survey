// initVars — everything a session carries before the first screen is drawn: the
// quota flags fetched on entry, one draw per A/B variable, and the URL parameters.
//
// It runs exactly once per session, from the useState initialiser in App. That
// "once" is a React lifecycle contract and cannot be asserted without a renderer;
// what is asserted here is what a single call produces, which is the part that
// decides the arm a respondent is measured in.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { initVars } from './App';
import { quotaFullVar } from './engine/quota';
import type { SurveyConfig } from './engine/types';

/** The suite runs in node — initVars reads window.location.search, so there has to be one. */
function withSearch(search: string): void {
  vi.stubGlobal('window', { location: { search } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const config: SurveyConfig = {
  version: 't',
  randomVars: { price: [79, 149, 249], pitch: ['saving', 'speed'] },
  screens: [{ id: 'a', type: 'info', title: '', body: '' }],
};

describe('initVars', () => {
  it('draws one value per declared variable, and only from that variable’s own list', () => {
    withSearch('');
    for (let i = 0; i < 100; i++) {
      const vars = initVars(config, {});
      expect(config.randomVars!.price).toContain(vars.price);
      expect(config.randomVars!.pitch).toContain(vars.pitch);
    }
  });

  it('carries the quota flags through untouched — they enter as ordinary session vars', () => {
    // Which is also how they reach the session_start payload, and how analysis
    // can tell which cells were already closed when a respondent arrived.
    withSearch('');
    const flag = quotaFullVar('persona', 'young_couple');
    expect(initVars(config, { [flag]: true })).toHaveProperty(flag, true);
  });

  it('captures every URL parameter behind a url_ prefix — this is what makes ?test=1 into url_test', () => {
    withSearch('?test=1&source=fb');
    const vars = initVars({ version: 't', screens: config.screens }, {});
    expect(vars).toEqual({ url_test: '1', url_source: 'fb' });
  });
});
