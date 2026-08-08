import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY_SLUG,
  isValidSlug,
  slugFromPath,
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

describe('surveyPath / slugFromPath', () => {
  it('keeps the default survey on the original link', () => {
    expect(surveyPath(DEFAULT_SURVEY_SLUG)).toBe('/');
    expect(slugFromPath('/')).toBe(DEFAULT_SURVEY_SLUG);
    expect(slugFromPath('/index.html')).toBe(DEFAULT_SURVEY_SLUG);
  });

  it('round-trips a named survey', () => {
    expect(surveyPath('pilot-2')).toBe('/s/pilot-2');
    expect(slugFromPath('/s/pilot-2')).toBe('pilot-2');
    expect(slugFromPath('/s/pilot-2/')).toBe('pilot-2');
  });

  it('returns null for a broken link instead of silently serving another survey', () => {
    expect(slugFromPath('/s/')).toBeNull();
    expect(slugFromPath('/s/Bad Slug')).toBeNull();
    expect(slugFromPath('/s/%E4%A1')).toBeNull();
  });
});

describe('starterConfig', () => {
  it('is publishable as-is — a new survey has no validation errors', () => {
    const issues = validateConfig(starterConfig('פיילוט'));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
