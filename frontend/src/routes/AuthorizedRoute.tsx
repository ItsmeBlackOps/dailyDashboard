// src/routes/AuthorizedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router-dom';

const isAuthed = () => Boolean(localStorage.getItem('accessToken'));

export default function AuthorizedRoute() {
  const location = useLocation();
  if (!isAuthed()) {
    return <Navigate to="/auth/signin" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
