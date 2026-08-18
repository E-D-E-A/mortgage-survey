// The console's home screen: every survey, each one's public link, and the
// management actions. This is the screen you enter a particular survey's editor
// from.
//
// Two distinctions this screen is strict about, because getting either wrong
// costs data:
//   • A draft ≠ what respondents see. A survey with no published version has a
//     link that will not work, so that is said explicitly and no clickable link
//     is shown.
//   • Archiving ≠ deleting. Archiving stops accepting new respondents and keeps
//     everything; deletion is only possible for a survey never published, which
//     therefore has no data.

import { useMemo, useState, type ReactNode } from 'react';
import { SURVEY_SLUG_MAX, SURVEY_SLUG_RE, slugify, surveyPath } from '../data/surveys';
import type { SurveySummary } from './api';
import type { Surveys } from './useSurveys';
import { CloseIcon, CopyIcon, ErrorIcon, PlusIcon, TrashIcon } from './Icons';

const dateFmt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' });

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

function publicUrl(slug: string): string {
  return `${window.location.origin}${surveyPath(slug)}`;
}

interface Props {
  surveys: Surveys;
  onOpen: (slug: string) => void;
  onStats: (slug: string) => void;
}

export function SurveyList({ surveys, onOpen, onStats }: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SurveySummary | null>(null);
  const [deleting, setDeleting] = useState<SurveySummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { active, archived } = useMemo(() => {
    return {
      active: surveys.items.filter((s) => !s.archived_at),
      archived: surveys.items.filter((s) => s.archived_at),
    };
  }, [surveys.items]);

  return (
    <div className="survey-list">
      <div className="survey-list-head">
        <div>
          <h2>השאלונים</h2>
          <p className="a-hint">
            לכל שאלון יש טיוטה משלו וקישור משלו. הקישור מתחיל לעבוד רק אחרי שמפרסמים גרסה ראשונה.
          </p>
        </div>
        <button className="a-btn primary" onClick={() => setCreating(true)}>
          <PlusIcon /> שאלון חדש
        </button>
      </div>

      {surveys.phase === 'loading' && <p className="a-hint">טוענים את השאלונים…</p>}

      {surveys.phase === 'error' && (
        <div className="admin-empty subtle">
          <p>לא הצלחנו לטעון את רשימת השאלונים.</p>
          <button className="a-btn primary" onClick={() => void surveys.reload()}>
            ניסיון נוסף
          </button>
        </div>
      )}

      {surveys.phase === 'ready' && active.length === 0 && archived.length === 0 && (
        <div className="admin-empty subtle">
          <p>עדיין אין כאן שאלונים. אפשר ליצור את הראשון עכשיו.</p>
          <button className="a-btn primary" onClick={() => setCreating(true)}>
            <PlusIcon /> שאלון חדש
          </button>
        </div>
      )}

      {active.map((s) => (
        <SurveyCard
          key={s.slug}
          survey={s}
          surveys={surveys}
          onOpen={onOpen}
          onStats={onStats}
          onRename={() => setRenaming(s)}
          onDelete={() => setDeleting(s)}
        />
      ))}

      {archived.length > 0 && (
        <section className="survey-archive">
          <button className="a-btn ghost small" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'הסתרת הארכיון' : `ארכיון (${archived.length})`}
          </button>
          {showArchived && (
            <>
              <p className="a-hint">
                שאלון בארכיון לא מקבל משיבים חדשים. כל הנתונים והגרסאות שפורסמו נשמרים, ומי שכבר
                התחיל לענות יכול לסיים.
              </p>
              {archived.map((s) => (
                <SurveyCard
                  key={s.slug}
                  survey={s}
                  surveys={surveys}
                  onOpen={onOpen}
                  onStats={onStats}
                  onRename={() => setRenaming(s)}
                  onDelete={() => setDeleting(s)}
                />
              ))}
            </>
          )}
        </section>
      )}

      {creating && (
        <CreateDialog
          surveys={surveys}
          taken={new Set(surveys.items.map((s) => s.slug))}
          onClose={() => setCreating(false)}
          onCreated={(slug) => {
            setCreating(false);
            onOpen(slug);
          }}
        />
      )}

      {renaming && (
        <RenameDialog surveys={surveys} survey={renaming} onClose={() => setRenaming(null)} />
      )}

      {deleting && (
        <DeleteDialog surveys={surveys} survey={deleting} onClose={() => setDeleting(null)} />
      )}

      {surveys.error && (
        <div className="toast-stack">
          <div className="cycle-toast" role="alert">
            <ErrorIcon width={16} height={16} />
            <div>
              <strong>הפעולה נכשלה</strong>
              <p>{surveys.error}</p>
            </div>
            <button className="a-icon-btn" onClick={surveys.dismissError} aria-label="סגירת ההודעה">
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SurveyCard({
  survey,
  surveys,
  onOpen,
  onStats,
  onRename,
  onDelete,
}: {
  survey: SurveySummary;
  surveys: Surveys;
  onOpen: (slug: string) => void;
  onStats: (slug: string) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const published = survey.versions > 0;
  const url = publicUrl(survey.slug);

  return (
    <article className={`survey-card${survey.archived_at ? ' archived' : ''}`}>
      <div className="survey-card-main">
        <div className="survey-card-title">
          <h3>{survey.name}</h3>
          <code dir="ltr">{survey.slug}</code>
          {survey.archived_at ? (
            <span className="chip">בארכיון</span>
          ) : published ? (
            <span className="chip chip-live">פעיל</span>
          ) : (
            <span className="chip">עוד לא פורסם</span>
          )}
        </div>

        <div className="survey-link">
          {published ? (
            <>
              <a href={url} target="_blank" rel="noreferrer" dir="ltr">
                {url}
              </a>
              <CopyLinkButton url={url} />
            </>
          ) : (
            <span className="a-hint">
              <bdi dir="ltr">{url}</bdi> — יתחיל לעבוד אחרי פרסום הגרסה הראשונה
            </span>
          )}
        </div>

        <p className="a-hint survey-meta">
          {published ? (
            <>
              הגרסה שפעילה עכשיו: <bdi dir="ltr">{survey.latest_version}</bdi>, פורסמה ב-{when(
                survey.latest_published_at,
              )} · {survey.versions === 1 ? 'גרסה אחת בסך הכול' : `${survey.versions} גרסאות בסך הכול`}
            </>
          ) : (
            'עדיין לא פורסמה אף גרסה'
          )}
          {survey.draft_updated_at && <> · הטיוטה עודכנה לאחרונה ב-{when(survey.draft_updated_at)}</>}
        </p>
      </div>

      <div className="survey-card-actions">
        <button className="a-btn primary small" onClick={() => onOpen(survey.slug)}>
          פתיחת העורך
        </button>
        <button
          className="a-btn ghost small"
          onClick={() => onStats(survey.slug)}
          title="כמה ענו, איפה נוטשים ומה ענו — בלי SQL"
        >
          סטטיסטיקות
        </button>
        <button className="a-btn ghost small" onClick={onRename} disabled={surveys.busy}>
          שינוי שם
        </button>
        {survey.archived_at ? (
          <button
            className="a-btn ghost small"
            onClick={() => void surveys.setArchived(survey.slug, false)}
            disabled={surveys.busy}
          >
            הוצאה מהארכיון
          </button>
        ) : (
          <button
            className="a-btn ghost small"
            onClick={() => void surveys.setArchived(survey.slug, true)}
            disabled={surveys.busy}
            title="השאלון יפסיק לקבל משיבים חדשים. כל הנתונים נשמרים, ואפשר להוציא אותו מהארכיון בכל רגע"
          >
            העברה לארכיון
          </button>
        )}
        {!published && (
          <button
            className="a-btn danger-ghost small"
            onClick={onDelete}
            disabled={surveys.busy}
            title="אפשר למחוק רק שאלון שלא פורסם מעולם, ולכן אין לו תשובות"
          >
            <TrashIcon /> מחיקה
          </button>
        )}
      </div>
    </article>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="a-btn ghost small"
      onClick={() => {
        navigator.clipboard.writeText(url).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => {
            /* A browser that blocks the clipboard — the link itself is on screen and can be selected by hand */
          },
        );
      }}
    >
      <CopyIcon /> {copied ? 'הקישור הועתק ✓' : 'העתקת הקישור'}
    </button>
  );
}

function Dialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="dialog-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <h2>{title}</h2>
          {!busy && (
            <button className="a-icon-btn" onClick={onClose} aria-label="סגירה">
              <CloseIcon />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

function CreateDialog({
  surveys,
  taken,
  onClose,
  onCreated,
}: {
  surveys: Surveys;
  taken: Set<string>;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  // A Hebrew name produces no usable slug, so the automatic suggestion only works
  // for an English name — with Hebrew we simply ask for an id explicitly.
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const slugOk = SURVEY_SLUG_RE.test(effectiveSlug);
  const duplicate = taken.has(effectiveSlug);
  const canSubmit = name.trim().length > 0 && slugOk && !duplicate && !surveys.busy;

  async function submit() {
    if (!canSubmit) return;
    if (await surveys.create(effectiveSlug, name.trim())) onCreated(effectiveSlug);
  }

  return (
    <Dialog title="שאלון חדש" onClose={onClose} busy={surveys.busy}>
      <label className="a-field">
        <span className="a-label">שם השאלון — לשימוש שלכם בקונסולה בלבד</span>
        <input
          className="a-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="פיילוט משכנתאות"
          autoFocus
        />
      </label>

      <label className="a-field">
        <span className="a-label">המזהה שיופיע בקישור (אותיות אנגליות קטנות, ספרות ומקפים)</span>
        <input
          className="a-input"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          placeholder="mortgage-pilot"
          dir="ltr"
          maxLength={SURVEY_SLUG_MAX}
        />
      </label>

      {effectiveSlug && slugOk && !duplicate && (
        <p className="dialog-note">
          הקישור לשאלון יהיה <bdi dir="ltr">{publicUrl(effectiveSlug)}</bdi>
        </p>
      )}
      {effectiveSlug && !slugOk && (
        <p className="dialog-note error-note">
          המזהה יכול להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד, והוא לא יכול להתחיל או להסתיים
          במקף.
        </p>
      )}
      {duplicate && <p className="dialog-note error-note">כבר יש שאלון עם המזהה הזה.</p>}
      <p className="dialog-note">
        שימו לב: המזהה קבוע. הוא מופיע בקישור שמחלקים למשיבים, ולכן אי אפשר לשנות אותו אחר כך. את
        השם אפשר לשנות מתי שרוצים.
      </p>

      <footer className="dialog-actions">
        <button className="a-btn ghost" onClick={onClose} disabled={surveys.busy}>
          ביטול
        </button>
        <button className="a-btn primary" onClick={() => void submit()} disabled={!canSubmit}>
          {surveys.busy ? 'יוצרים…' : 'יצירה ומעבר לעורך'}
        </button>
      </footer>
    </Dialog>
  );
}

function RenameDialog({
  surveys,
  survey,
  onClose,
}: {
  surveys: Surveys;
  survey: SurveySummary;
  onClose: () => void;
}) {
  const [name, setName] = useState(survey.name);
  const canSubmit = name.trim().length > 0 && !surveys.busy;

  return (
    <Dialog title="שינוי שם השאלון" onClose={onClose} busy={surveys.busy}>
      <label className="a-field">
        <span className="a-label">שם השאלון</span>
        <input
          className="a-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
      <p className="dialog-note">
        המזהה שבקישור (<bdi dir="ltr">{survey.slug}</bdi>) לא משתנה, ולכן כל הקישורים שכבר חולקו
        ימשיכו לעבוד.
      </p>
      <footer className="dialog-actions">
        <button className="a-btn ghost" onClick={onClose} disabled={surveys.busy}>
          ביטול
        </button>
        <button
          className="a-btn primary"
          onClick={() => void surveys.rename(survey.slug, name.trim()).then((ok) => ok && onClose())}
          disabled={!canSubmit}
        >
          שמירה
        </button>
      </footer>
    </Dialog>
  );
}

function DeleteDialog({
  surveys,
  survey,
  onClose,
}: {
  surveys: Surveys;
  survey: SurveySummary;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');

  return (
    <Dialog title="מחיקת שאלון" onClose={onClose} busy={surveys.busy}>
      <p className="dialog-note error-note">
        המחיקה תמחק את השאלון ״{survey.name}״ ואת הטיוטה שלו לצמיתות. אי אפשר לבטל אותה.
      </p>
      <p className="dialog-note">
        השאלון הזה לא פורסם מעולם, ולכן אין לו תשובות. שאלון שכבר פורסם אי אפשר למחוק — שם הפעולה
        הנכונה היא העברה לארכיון.
      </p>
      <label className="a-field">
        <span className="a-label">
          כדי לאשר, הקלידו כאן את המזהה <bdi dir="ltr">{survey.slug}</bdi>
        </span>
        <input
          className="a-input"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          dir="ltr"
          autoFocus
        />
      </label>
      <footer className="dialog-actions">
        <button className="a-btn ghost" onClick={onClose} disabled={surveys.busy}>
          ביטול
        </button>
        <button
          className="a-btn danger-ghost"
          onClick={() => void surveys.remove(survey.slug).then((ok) => ok && onClose())}
          disabled={confirmText.trim() !== survey.slug || surveys.busy}
        >
          <TrashIcon /> מחיקה לצמיתות
        </button>
      </footer>
    </Dialog>
  );
}
