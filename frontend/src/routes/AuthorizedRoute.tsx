// src/routes/AuthorizedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { NotificationProvider } from '@/context/NotificationContext';
import { MicrosoftConsentProvider } from '@/contexts/MicrosoftConsentContext';

const PROFILE_HUB_ROLES = ['admin', 'mam', 'mm', 'mlead', 'recruiter'];
// Marketing-team-only pages — must match Sidebar visibility rules.
const JOBS_ROLES = ['admin', 'mm', 'mam', 'mlead'];

const isAuthed = () => Boolean(localStorage.getItem('accessToken'));
const isAdmin = () => (localStorage.getItem('role') || '').trim().toLowerCase() === 'admin';
const isMarketing = () => localStorage.getItem('role') === 'MAM' || localStorage.getItem('role') === 'MM';
const getRole = () => (localStorage.getItem('role') || '').trim().toLowerCase();

export default function AuthorizedRoute() {
  const location = useLocation();

  if (location.pathname === '/reports' && !isMarketing()) {
    return <Navigate to="/tasks" replace state={{ from: location }} />;
  }

  if (location.pathname === '/profile-hub' && !PROFILE_HUB_ROLES.includes(getRole())) {
    return <Navigate to="/tasks" replace state={{ from: location }} />;
  }

  // /jobs (and /jobs/:sessionId) — marketing team only.
  if (location.pathname.startsWith('/jobs') && !JOBS_ROLES.includes(getRole())) {
    return <Navigate to="/tasks" replace state={{ from: location }} />;
  }

  // /admin-alerts — admin only.
  if (location.pathname === '/admin-alerts' && !isAdmin()) {
    return <Navigate to="/tasks" replace state={{ from: location }} />;
  }
  if (!isAuthed()) {
    return <Navigate to="/auth/signin" replace state={{ from: location }} />;
  }
  return (
    <MicrosoftConsentProvider>
      <NotificationProvider>
        <Outlet />
      </NotificationProvider>
    </MicrosoftConsentProvider>
  );
}
