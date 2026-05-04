import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { ErrorBoundary } from './components/ErrorBoundary';

// C20 — one-shot localStorage reset. Pre-PR #104 logins cached new-name
// roles ('teamLead', 'assistantManager', 'expert') WITHOUT the `team`
// field, which left the alias shim unable to disambiguate teamLead
// (lead vs mlead) and assistantManager (am vs mam). Net effect: tasks,
// branch candidates, user management — every legacy role-gated UI broke
// for those users. The fix is to wipe stale auth state once and force a
// fresh login, where the SignIn shim writes a correctly-scoped role.
//
// Guarded by a sentinel so it fires exactly once per browser. Bump the
// sentinel suffix if a future migration needs to wipe state again.
const C20_STORAGE_RESET_KEY = 'c20_storage_reset_v1';
try {
  if (!localStorage.getItem(C20_STORAGE_RESET_KEY)) {
    // Preserve nothing — clearing tokens too forces re-login through
    // the post-PR-104 SignIn flow, which writes role/team/roleCanonical
    // correctly. We mark the sentinel BEFORE clearing so a partial
    // failure doesn't loop.
    localStorage.setItem(C20_STORAGE_RESET_KEY, new Date().toISOString());
    const sentinel = localStorage.getItem(C20_STORAGE_RESET_KEY);
    localStorage.clear();
    if (sentinel) {
      localStorage.setItem(C20_STORAGE_RESET_KEY, sentinel);
    }
    // If we wiped credentials and we're not already on /signin, bounce
    // there. Routing isn't mounted yet at module-eval, so set a hint
    // and let AuthorizedRoute handle the redirect on its first render.
    if (typeof window !== 'undefined' && window.location.pathname !== '/signin') {
      // history.replaceState avoids a server round-trip; React Router
      // picks this up on mount.
      window.history.replaceState({}, '', '/signin');
    }
  }
} catch {
  // localStorage may be locked down in some environments — give up
  // silently. Worst case: the user sees the already-known broken UI
  // and can manually clear browser storage.
}

// Eager imports — auth, layout, and the landing page after login
import SignIn from './pages/auth/SignIn';
import TasksToday from './pages/TasksToday';
import { Toaster } from './components/ui/toaster';
import { Toast } from './components/ui/toast';
import Index from './pages/Index';
import AuthorizedRoute from './routes/AuthorizedRoute';
import DashboardV2 from './pages/DashboardV2';
import AdminAlertsPage from './pages/AdminAlerts';
import UserManagementPage from './pages/UserManagement';
import DelegationsPage from './pages/Delegations';
import PermissionsManagement from './pages/PermissionsManagement';

// Lazy imports — heavy/secondary pages, split into their own chunks
const Reports = lazy(() => import('./pages/Reports'));
const ReportAssistant = lazy(() => import('./pages/ReportAssistant'));
const BranchCandidatesPage = lazy(() => import('./pages/BranchCandidates'));
const ResumeUnderstanding = lazy(() => import('./pages/ResumeUnderstanding'));
const ProfileHubPage = lazy(() => import('./pages/ProfileHubPage'));
const CandidateDetailPage = lazy(() => import('./pages/CandidateDetailPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const AdminPerformance = lazy(() => import('./pages/AdminPerformance'));
const AdminInterviewSupport = lazy(() => import('./pages/AdminInterviewSupport'));
const JobsPage = lazy(() => import('./pages/JobsPage'));
const CandidateJobsListPage = lazy(() => import('./pages/CandidateJobsListPage'));
const JobsListPage = lazy(() => import('./pages/JobsListPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));

// Minimal loading splash shown while lazy chunks are fetched
const LoadingSplash = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100vw',
  }}>
    <div style={{
      width: 40,
      height: 40,
      border: '4px solid #e5e7eb',
      borderTop: '4px solid #6366f1',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingSplash />}>
            <Routes>
              {/* Protected dashboard for admin only */}
              <Route element={<AuthorizedRoute />}>
                <Route path="/" element={<DashboardV2 />} />
                <Route path="/legacy-dashboard" element={<Index />} />
                <Route path="/tasks" element={<TasksToday />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/reports/assistant" element={<ReportAssistant />} />
                <Route path="/branch-candidates" element={<BranchCandidatesPage />} />
                <Route path="/admin-alerts" element={<AdminAlertsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/resume-understanding" element={<ResumeUnderstanding />} />
                <Route path="/user-management" element={<UserManagementPage />} />
                <Route path="/delegations" element={<DelegationsPage />} />
                <Route path="/permissions" element={<PermissionsManagement />} />
                <Route path="/dashboard-v2" element={<DashboardV2 />} />
                <Route path="/profile-hub" element={<ProfileHubPage />} />
                <Route path="/candidate/:id" element={<CandidateDetailPage />} />
                <Route path="/task/:taskId" element={<TaskDetailPage />} />
                <Route path="/admin/performance" element={<AdminPerformance />} />
                <Route path="/admin/interview-support" element={<AdminInterviewSupport />} />
                <Route path="/jobs" element={<JobsListPage />} />
                <Route path="/jobs/:sessionId" element={<JobsPage />} />
                <Route path="/candidate/:candidateId/jobs" element={<CandidateJobsListPage />} />
                {/* Add any other protected routes here */}
              </Route>

              <Route path="/auth/signin" element={<SignIn />} />
              <Route path="/toast" element={<Toast />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
