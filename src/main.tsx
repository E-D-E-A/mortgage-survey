import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import './styles.css';

// קונסולת הניהול נטענת כ-chunk נפרד — קוד העריכה (dnd-kit, Google auth)
// לא נכנס לבאנדל שהמשיבים מורידים.
const AdminApp = lazy(() => import('./admin/AdminApp'));

const isAdmin = window.location.pathname.startsWith('/admin');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? (
      <Suspense fallback={<div className="app" />}>
        <AdminApp />
      </Suspense>
    ) : (
      <AppShell />
    )}
  </StrictMode>,
);
