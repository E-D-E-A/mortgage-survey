// פאנל השגיאות: שגיאות (חוסמות פרסום) ואזהרות, בזמן אמת על כל שינוי.
// לחיצה על ממצא בוחרת את המסך הרלוונטי.

import type { ValidationIssue } from '../engine/validate';
import type { Naming } from './display';
import { humanizeMessage } from './display';
import { CheckIcon, ErrorIcon, WarningIcon } from './Icons';

interface Props {
  issues: ValidationIssue[];
  naming: Naming;
  onSelectScreen: (id: string) => void;
}

export function ValidationPanel({ issues, naming, onSelectScreen }: Props) {
  if (issues.length === 0) {
    return (
      <div className="validation-panel ok" role="status">
        <CheckIcon width={14} height={14} /> הכול תקין — אפשר לפרסם
      </div>
    );
  }
  return (
    <div className="validation-panel" role="alert">
      <ul className="validation-list">
        {issues.map((issue, i) => (
          <li key={i} className={`validation-item ${issue.level}`}>
            {issue.level === 'error' ? (
              <ErrorIcon width={14} height={14} />
            ) : (
              <WarningIcon width={14} height={14} />
            )}
            {issue.screenId ? (
              <button className="validation-link" onClick={() => onSelectScreen(issue.screenId!)}>
                {humanizeMessage(naming, issue.message)}
              </button>
            ) : (
              <span>{humanizeMessage(naming, issue.message)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
