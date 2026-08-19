// Survey identity — shared by the browser and the Netlify Functions (both import
// from here). The slug is a survey's only identifier: it is the key in the DB,
// the parameter on the API endpoints, and what appears in the public link. So it
// is restricted to characters that are safe in a URL and in PostgREST queries,
// and the check is repeated on the server (we never trust the browser).
// ⚠ Exactly this pattern is the check on surveys.slug in supabase/schema.sql.

/**
 * The survey the API endpoints fall back to when a request omits `?survey=`,
 * left over from the single-survey model.
 *
 * ⚠ This is no longer a routing concept. No URL resolves to a survey implicitly
 * — see resolveRoute, and the comment on it for why.
 */
export const DEFAULT_SURVEY_SLUG = 'main';

export const SURVEY_SLUG_MAX = 40;

/**
 * The longest a published version name can be.
 *
 * ⚠ One definition, because three endpoints depend on agreeing: admin-publish
 * builds the name and slices to this, config-get and admin-versions accept one
 * up to this. A reader with a smaller cap than the writer rejects versions that
 * legitimately exist — and only the long ones, which are the ones carrying a
 * descriptive label.
 */
export const MAX_VERSION_CHARS = 100;

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

/** A survey's public path. Every survey lives under `/s/`, with no exceptions. */
export function surveyPath(slug: string): string {
  return `/s/${slug}`;
}

export type Route =
  | { kind: 'admin' }
  | { kind: 'survey'; slug: string }
  /** A `/s/…` link whose slug is malformed — an attempt at a survey that cannot resolve. */
  | { kind: 'broken-link' }
  /** Anything else, including `/`: a page that is deliberately not a survey. */
  | { kind: 'landing' };

/**
 * What the current URL is asking for.
 *
 * ⚠ Only `/s/<slug>` ever produces a survey. This is a data-integrity rule, not
 * a routing preference: App logs `session_start` the moment it mounts, so any
 * path that renders a survey becomes a counted respondent — one that inflates
 * the statistics, can consume a quota place, and cannot be marked as a test
 * afterwards. Before this, every unmatched path (`/`, `/pricing`, a typo, a
 * crawler guessing) served the default survey and recorded exactly that.
 */
export function resolveRoute(pathname: string): Route {
  if (pathname.startsWith('/admin')) return { kind: 'admin' };
  const m = pathname.match(/^\/s\/([^/]*)\/?$/);
  if (!m) return { kind: 'landing' };
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return { kind: 'broken-link' };
  }
  return isValidSlug(slug) ? { kind: 'survey', slug } : { kind: 'broken-link' };
}
