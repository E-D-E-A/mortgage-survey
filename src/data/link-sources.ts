// The channels a survey link is handed out through.
//
// Fixed in code, deliberately. Two rules from the operating guide depend on the
// link carrying the right parameter, and both are easy to get wrong by hand:
//
//   • A link sent to a real channel carries ?source=<id>, which is what makes
//     the statistics comparable by channel. The values have no fixed set on the
//     reading side (see admin/stats.ts), so a typo silently invents a new
//     channel that no one ever compares against anything.
//   • Internal use goes through ?test=1 from the very first click. Opening a
//     link without it records a real respondent session before anyone answers
//     anything, counts against quotas, and cannot be marked as a test afterwards
//     from the console.
//
// Buttons built from this list make both correct by construction.

export interface LinkSource {
  /** For a channel — the value that lands in `url_source`. */
  id: string;
  label: string;
  /** A test link is not a channel: it carries `?test=1` and no source at all. */
  test?: true;
}

export const LINK_SOURCES: readonly LinkSource[] = [
  { id: 'facebook', label: 'פייסבוק' },
  { id: 'whatsapp', label: 'ווטסאפ' },
  { id: 'panel', label: 'פאנל' },
  { id: 'test', label: 'בדיקה פנימית', test: true },
];

/** The full link for one source, built on a survey's public URL. */
export function sourceLink(publicUrl: string, source: LinkSource): string {
  return source.test ? `${publicUrl}?test=1` : `${publicUrl}?source=${source.id}`;
}
