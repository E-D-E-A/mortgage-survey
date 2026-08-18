// Survey identity — shared by the browser and the Netlify Functions (both import
// from here). The slug is a survey's only identifier: it is the key in the DB,
// the parameter on the API endpoints, and what appears in the public link. So it
// is restricted to characters that are safe in a URL and in PostgREST queries,
// and the check is repeated on the server (we never trust the browser).
// ⚠ Exactly this pattern is the check on surveys.slug in supabase/schema.sql.

/** The survey served on the old link, with no slug (`/`). Created by the migration from the single-survey model. */
export const DEFAULT_SURVEY_SLUG = 'main';

export const SURVEY_SLUG_MAX = 40;

/** Lowercase letters, digits and hyphens; does not start or end with a hyphen. */
export const SURVEY_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SURVEY_SLUG_RE.test(value);
}

/**
 * Suggests a slug from a Hebrew name. Hebrew does not survive in a URL (encoded
 * characters in a link pasted into WhatsApp look like garbage), so a purely
 * Hebrew name returns an empty string and the editor is asked to type a slug in
 * English.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SURVEY_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** A survey's public path. The default survey stays on `/` — links already handed out. */
export function surveyPath(slug: string): string {
  return slug === DEFAULT_SURVEY_SLUG ? '/' : `/s/${slug}`;
}

/**
 * The slug of the survey the current page is showing. Any path that is not
 * `/s/<slug>` is the main survey (which is how links handed out before
 * multi-survey support keep working), and null marks a malformed link — better
 * to show "not found" than to quietly serve a different survey.
 */
export function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/s\/([^/]*)\/?$/);
  if (!m) return DEFAULT_SURVEY_SLUG;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isValidSlug(slug) ? slug : null;
}
