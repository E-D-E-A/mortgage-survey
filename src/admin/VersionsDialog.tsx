// Published versions: which one is live, what each one actually said, what
// changed between two of them, and putting one back into the draft.
//
// Why this is a separate surface and not a mode of the editor: a published
// version is frozen — the collected answers refer to it, and nothing may ever
// write one back. Read-only here is therefore structural rather than a flag
// somebody could get wrong: this component has no editing path at all, and
// renders a version through the outline (the same Hebrew wording the MCP server
// shows) instead of through the editor's controls.
//
// The comparison reuses admin/diff.ts, the same engine behind the agent's
// propose→confirm→apply diff. One implementation on purpose: if the console had
// its own, the two could describe the same change differently and the one you
// trusted would be whichever you happened to open.

import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  getVersion,
  listVersions,
  type PublishedVersion,
  type VersionSummary,
} from './api';
import { diffConfigs, renderDiff } from './diff';
import { buildOutline } from './outline';
import { CloseIcon } from './Icons';
import type { SurveyConfig } from '../engine/types';

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' });

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

type Phase =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'ready'; versions: VersionSummary[] };

/** What the right-hand pane is showing. */
type Pane =
  | { view: 'none' }
  | { view: 'busy' }
  | { view: 'version'; loaded: PublishedVersion }
  | { view: 'compare'; from: PublishedVersion; to: PublishedVersion }
  | { view: 'failed'; message: string };

interface Props {
  slug: string;
  /** The draft as it stands in the editor — the comparison's other side. */
  draftConfig: SurveyConfig | null;
  /** True when the editor holds edits that were never saved. */
  draftDirty: boolean;
  /** Replaces the draft with a published version's content. */
  onRestore: (config: SurveyConfig, version: string) => void;
  onClose: () => void;
}

export function VersionsDialog({ slug, draftConfig, draftDirty, onRestore, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ step: 'loading' });
  const [pane, setPane] = useState<Pane>({ view: 'none' });
  const [selected, setSelected] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string>('');
  const [confirmRestore, setConfirmRestore] = useState<PublishedVersion | null>(null);

  useEffect(() => {
    let live = true;
    listVersions(slug).then(
      (versions) => live && setPhase({ step: 'ready', versions }),
      (e: unknown) =>
        live &&
        setPhase({
          step: 'error',
          message:
            e instanceof ApiError && e.status === 404
              ? 'לשאלון הזה עדיין לא פורסמה אף גרסה.'
              : 'טעינת רשימת הגרסאות נכשלה.',
        }),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  const openVersion = useCallback(
    async (version: string) => {
      setSelected(version);
      setCompareWith('');
      setPane({ view: 'busy' });
      try {
        setPane({ view: 'version', loaded: await getVersion(slug, version) });
      } catch {
        setPane({ view: 'failed', message: 'טעינת תוכן הגרסה נכשלה.' });
      }
    },
    [slug],
  );

  /**
   * Compares two versions, always oldest → newest.
   *
   * ⚠ Not in the order they were picked. A diff read backwards reports removed
   * screens as added, which is precisely the question someone opens this to
   * answer — and the heading alone was not enough to stop it being misread.
   * The list arrives newest-first, so a later index is the older version.
   */
  const compare = useCallback(
    async (a: string, b: string, ordered: VersionSummary[]) => {
      setPane({ view: 'busy' });
      const indexOf = (v: string) => ordered.findIndex((x) => x.version === v);
      const [olderVersion, newerVersion] = indexOf(a) > indexOf(b) ? [a, b] : [b, a];
      try {
        const [from, to] = await Promise.all([
          getVersion(slug, olderVersion),
          getVersion(slug, newerVersion),
        ]);
        setPane({ view: 'compare', from, to });
      } catch {
        setPane({ view: 'failed', message: 'טעינת הגרסאות להשוואה נכשלה.' });
      }
    },
    [slug],
  );

  const versions = phase.step === 'ready' ? phase.versions : [];
  // Newest first comes from the server; the first row is what respondents get
  // now and the second is what it replaced.
  const liveVersion = versions[0]?.version ?? null;
  const previousVersion = versions[1]?.version ?? null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog wide"
        role="dialog"
        aria-modal="true"
        aria-label="גרסאות השאלון"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>גרסאות השאלון</h2>
          <button className="a-icon-btn" onClick={onClose} aria-label="סגירה">
            <CloseIcon />
          </button>
        </div>

        <div className="versions-body">
          <aside className="versions-list">
            {/* The draft always sits at the top, because "what am I editing?"
                is the question this dialog exists to answer. */}
            <article className={`version-row${selected === null ? ' selected' : ''}`}>
              <button
                className="version-pick"
                onClick={() => {
                  setSelected(null);
                  setPane({ view: 'none' });
                }}
              >
                <span className="version-name">טיוטה</span>
                <span className="chip chip-draft">
                  {draftDirty ? 'שינויים שלא נשמרו' : 'לא פורסמה'}
                </span>
              </button>
              <p className="a-hint">זה מה שפתוח בעורך. המשיבים לא רואים אותה עד שמפרסמים.</p>
            </article>

            {phase.step === 'loading' && <p className="a-hint">טוענים גרסאות…</p>}
            {phase.step === 'error' && <p className="a-hint">{phase.message}</p>}
            {/* The list endpoint answers an unpublished survey with an empty
                array, not a 404 — so without this the picker just stopped after
                the draft row, with nothing saying why. */}
            {phase.step === 'ready' && versions.length === 0 && (
              <p className="a-hint">
                עדיין לא פורסמה אף גרסה. אחרי הפרסום הראשון תופיע כאן כל גרסה, ויהיה אפשר לקרוא
                אותה, להשוות ולשחזר.
              </p>
            )}

            {versions.map((v) => (
              <article
                key={v.version}
                className={`version-row${selected === v.version ? ' selected' : ''}`}
              >
                <button className="version-pick" onClick={() => void openVersion(v.version)}>
                  <span className="version-name" dir="ltr">
                    {v.version}
                  </span>
                  {v.version === liveVersion && <span className="chip chip-live">פעילה</span>}
                  {v.version === previousVersion && <span className="chip">הקודמת</span>}
                </button>
                <p className="a-hint">פורסמה ב-{when(v.published_at)}</p>
              </article>
            ))}
          </aside>

          <section className="versions-pane">
            {pane.view === 'none' && (
              <div className="admin-empty subtle">
                <p>
                  בחרו גרסה כדי לקרוא את תוכנה. גרסה שפורסמה קפואה — אפשר לקרוא, להשוות ולשחזר
                  לתוך הטיוטה, אבל לא לערוך אותה.
                </p>
              </div>
            )}

            {pane.view === 'busy' && <p className="a-hint">טוענים…</p>}
            {pane.view === 'failed' && <p className="a-hint">{pane.message}</p>}

            {pane.view === 'version' && (
              <>
                <div className="versions-actions">
                  <label className="a-label" htmlFor="compare-with">
                    השוואה מול
                  </label>
                  <select
                    id="compare-with"
                    className="a-select"
                    value={compareWith}
                    onChange={(e) => {
                      setCompareWith(e.target.value);
                      if (e.target.value) void compare(e.target.value, pane.loaded.version, versions);
                    }}
                    title="ההשוואה נקראת תמיד מהישנה לחדשה, ולא לפי סדר הבחירה"
                  >
                    <option value="">— בחרו גרסה —</option>
                    {versions
                      .filter((v) => v.version !== pane.loaded.version)
                      .map((v) => (
                        <option key={v.version} value={v.version}>
                          {v.version}
                        </option>
                      ))}
                  </select>
                  <button
                    className="a-btn secondary small"
                    onClick={() => setConfirmRestore(pane.loaded)}
                  >
                    שחזור לתוך הטיוטה
                  </button>
                </div>
                <pre className="version-outline">{buildOutline(pane.loaded.config)}</pre>
              </>
            )}

            {pane.view === 'compare' && (
              <>
                <p className="a-hint">
                  מה השתנה מ-<bdi dir="ltr">{pane.from.version}</bdi> ל-
                  <bdi dir="ltr">{pane.to.version}</bdi>:
                </p>
                <pre className="version-outline">
                  {renderDiff(diffConfigs(pane.from.config, pane.to.config))}
                </pre>
              </>
            )}
          </section>
        </div>

        {confirmRestore && (
          <div className="dialog-backdrop" onClick={() => setConfirmRestore(null)}>
            <div
              className="dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="שחזור גרסה לתוך הטיוטה"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dialog-head">
                <h2>שחזור גרסה לתוך הטיוטה</h2>
              </div>
              <div className="dialog-note">
                <p>
                  תוכן הגרסה <bdi dir="ltr">{confirmRestore.version}</bdi> ייטען לעורך במקום
                  הטיוטה הנוכחית. הגרסה עצמה לא משתנה, ושום דבר לא מתפרסם.
                </p>
                {/* Two different losses. Unsaved edits are only in memory, so
                    they go the moment they are replaced. A saved draft survives
                    the restore in the undo stack — but if it was never
                    published, saving over it leaves it in no version table and
                    no draft row, and it is gone for good. */}
                {draftDirty ? (
                  <p className="dialog-note warning-note">
                    בטיוטה יש שינויים שלא נשמרו, והם יאבדו מיד. אפשר לסגור, לשמור, ואז לשחזר.
                  </p>
                ) : (
                  draftConfig && (
                    <p className="dialog-note warning-note">
                      תוכן הטיוטה הנוכחית יוחלף. אם הוא לא פורסם מעולם, אחרי שמירה לא תהיה דרך
                      לחזור אליו — עד לשמירה אפשר לבטל בעזרת ביטול פעולה.
                    </p>
                  )
                )}
                {!draftConfig && <p className="a-hint">לשאלון הזה אין עדיין טיוטה — תיווצר אחת.</p>}
              </div>
              <div className="dialog-actions">
                <button className="a-btn ghost" onClick={() => setConfirmRestore(null)}>
                  ביטול
                </button>
                <button
                  className="a-btn primary"
                  onClick={() => {
                    onRestore(confirmRestore.config, confirmRestore.version);
                    setConfirmRestore(null);
                    onClose();
                  }}
                >
                  שחזור
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
