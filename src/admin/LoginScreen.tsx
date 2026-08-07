// מסך כניסה: כפתור Google Identity Services. הכפתור הוא UX בלבד —
// האכיפה האמיתית (דומיין first-edea.com) נעשית בצד השרת ב-admin-auth.

import { useEffect, useRef, useState } from 'react';
import { login } from './api';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

interface GisId {
  initialize(config: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, config: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GisId } };
  }
}

export function LoginScreen({ onLogin }: { onLogin: (email: string) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    function init() {
      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID!,
        callback: ({ credential }) => {
          login(credential)
            .then(({ email }) => onLogin(email))
            .catch((e: Error) => {
              setError(
                e.message === 'forbidden'
                  ? 'הכניסה מוגבלת לחשבונות first-edea.com בלבד'
                  : 'הכניסה נכשלה — נסו שוב',
              );
            });
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        locale: 'he',
        text: 'signin_with',
        width: 280,
      });
    }

    if (window.google) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.onload = init;
      script.onerror = () => setError('טעינת Google נכשלה — בדקו את החיבור');
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
  }, [onLogin]);

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>ניהול השאלון</h1>
        <p className="a-hint">כניסה מוגבלת לחשבונות first-edea.com</p>
        {CLIENT_ID ? (
          <div ref={buttonRef} className="gis-button" />
        ) : (
          <p className="a-hint error-text">
            חסר VITE_GOOGLE_CLIENT_ID — הגדירו את משתני הסביבה והריצו מחדש (ראו README)
          </p>
        )}
        {error && (
          <p className="a-hint error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
