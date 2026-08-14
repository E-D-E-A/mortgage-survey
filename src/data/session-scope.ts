// Every one of the respondent's sessionStorage keys carries the slug of the
// survey they opened. Without that, opening a second survey in the same tab
// would restore the first one's session: the same session_id, the same saved
// state and the same config snapshot.
//
// The default survey deliberately keeps the original keys — respondents who are
// mid-survey there carry on even after this version ships.

import { DEFAULT_SURVEY_SLUG } from './surveys';

let scope = DEFAULT_SURVEY_SLUG;

/** Called once on page load, before any call to scopedKey. */
export function setSurveyScope(slug: string): void {
  scope = slug;
}

export function currentSurveyScope(): string {
  return scope;
}

export function scopedKey(base: string): string {
  return scope === DEFAULT_SURVEY_SLUG ? base : `${base}:${scope}`;
}
