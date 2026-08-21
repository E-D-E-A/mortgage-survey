import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY_SLUG,
  isValidSlug,
  resolveRoute,
  SURVEY_SLUG_MAX,
  slugify,
  surveyPath,
} from './surveys';
import { validateConfig } from '../engine/validate';
import { starterConfig } from '../questionnaire/starter';

describe('isValidSlug', () => {
  it('accepts lowercase letters, digits and inner hyphens', () => {
    expect(isValidSlug('main')).toBe(true);
    expect(isValidSlug('mortgage-pilot-2')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('rejects anything that would break a URL or a PostgREST filter', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('-lead')).toBe(false);
    expect(isValidSlug('trail-')).toBe(false);
    expect(isValidSlug('Upper')).toBe(false);
    expect(isValidSlug('with space')).toBe(false);
    expect(isValidSlug('פיילוט')).toBe(false);
    expect(isValidSlug('a.b')).toBe(false);
    expect(isValidSlug('eq.main')).toBe(false);
    expect(isValidSlug('a'.repeat(41))).toBe(false);
    expect(isValidSlug(null)).toBe(false);
  });
});

describe('slugify', () => {
  it('suggests a slug from a latin name', () => {
    expect(slugify('Mortgage Pilot 2')).toBe('mortgage-pilot-2');
    expect(slugify('  --Trailing--  ')).toBe('trailing');
  });

  it('returns empty for a hebrew-only name, so the editor is asked for one', () => {
    expect(slugify('פיילוט משכנתאות')).toBe('');
  });

  it('never produces a slug it would then reject', () => {
    for (const name of ['Hello World!', 'a'.repeat(60), '2026 — pilot', 'x/y/z']) {
      const slug = slugify(name);
      if (slug) expect(isValidSlug(slug)).toBe(true);
    }
  });
});

describe('surveyPath / resolveRoute', () => {
  it('puts every survey under /s/, the default one included', () => {
    expect(surveyPath(DEFAULT_SURVEY_SLUG)).toBe(`/s/${DEFAULT_SURVEY_SLUG}`);
    expect(surveyPath('pilot-2')).toBe('/s/pilot-2');
  });

  it('round-trips a named survey', () => {
    expect(resolveRoute('/s/pilot-2')).toEqual({ kind: 'survey', slug: 'pilot-2' });
    expect(resolveRoute('/s/pilot-2/')).toEqual({ kind: 'survey', slug: 'pilot-2' });
  });

  // The reason this rule exists: App logs session_start on mount, so any path
  // that resolves to a survey becomes a counted respondent. `/` used to serve
  // the main survey, and so did every typo and crawler hit.
  it('never serves a survey from a path that is not /s/<slug>', () => {
    for (const path of ['/', '/index.html', '/pricing', '/s', '/s/pilot-2/extra', '/admn']) {
      expect(resolveRoute(path)).toEqual({ kind: 'landing' });
    }
  });

  it('marks a malformed /s/ link as broken rather than serving another survey', () => {
    expect(resolveRoute('/s/')).toEqual({ kind: 'broken-link' });
    expect(resolveRoute('/s/Bad Slug')).toEqual({ kind: 'broken-link' });
    expect(resolveRoute('/s/%E4%A1')).toEqual({ kind: 'broken-link' });
  });

  // Two different failures, and only one of them throws. %E4%A1 above is
  // undecodable, so decodeURIComponent raises and the catch handles it. These
  // decode perfectly well and are then rejected by isValidSlug — a separate
  // branch, and the one that would quietly mount a survey under a slug nobody
  // created if it ever stopped rejecting.
  it('rejects input that decodes cleanly but is still not a slug', () => {
    expect(resolveRoute('/s/%20')).toEqual({ kind: 'broken-link' });
    expect(resolveRoute('/s/%D7%A9%D7%9C%D7%95%D7%9D')).toEqual({ kind: 'broken-link' });
    expect(resolveRoute('/s/-leading-hyphen')).toEqual({ kind: 'broken-link' });
    expect(resolveRoute('/s/UPPER')).toEqual({ kind: 'broken-link' });
  });

  it('applies the slug length limit on the path, not just in isValidSlug', () => {
    const longest = 'a'.repeat(SURVEY_SLUG_MAX);
    expect(resolveRoute(`/s/${longest}`)).toEqual({ kind: 'survey', slug: longest });
    expect(resolveRoute(`/s/${'a'.repeat(SURVEY_SLUG_MAX + 1)}`)).toEqual({ kind: 'broken-link' });
  });

  it('routes the console', () => {
    expect(resolveRoute('/admin')).toEqual({ kind: 'admin' });
    expect(resolveRoute('/admin/demo')).toEqual({ kind: 'admin' });
    expect(resolveRoute('/admin/demo/stats')).toEqual({ kind: 'admin' });
  });
});

describe('starterConfig', () => {
  it('is publishable as-is — a new survey has no validation errors', () => {
    const issues = validateConfig(starterConfig('פיילוט'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
