// src/routes/AuthorizedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { NotificationProvider } from '@/context/NotificationContext';
import { MicrosoftConsentProvider } from '@/contexts/MicrosoftConsentContext';

const isAuthed = () => Boolean(localStorage.getItem('accessToken'));
const isAdmin = () => localStorage.getItem('role') === 'admin';
const isMarketing = () => localStorage.getItem('role') === 'MAM' || localStorage.getItem('role') === 'MM';
export default function AuthorizedRoute() {
  const location = useLocation();
  // Only allow / (dashboard) for admin


  if (location.pathname === '/reports' && !isMarketing()) {
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
