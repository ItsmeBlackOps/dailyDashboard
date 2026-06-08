import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
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
// Bumped to v2 — v1 fired correctly but the login callback was dropping
// the `team` field, so every technical teamLead got 'mlead' in their
// freshly-rebuilt localStorage. Backend fix landed alongside this v2
// bump; v2 forces another reset so users re-login and get the corrected
// team/role values.
const C20_STORAGE_RESET_KEY = 'c20_storage_reset_v2';
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
import { Toaster } from './components/ui/toaster';
import { Toast } from './components/ui/toast';
import AuthorizedRoute from './routes/AuthorizedRoute';

// C1 — lazy-load every auth-gated route. Previously these were all
// eager imports (~200-300 KB combined), meaning every login parsed
// every page even if the user never visited some. On i5 5th gen / 8 GB
// hardware that's seconds of JS parse before first paint. Now each
// route's chunk loads only when navigated to. The Suspense boundary
// below renders a fast skeleton while the chunk streams in.
const TasksToday = lazyWithRetry(() => import('./pages/TasksToday'));
const NotificationSettings = lazyWithRetry(() => import('./pages/NotificationSettings'));
const Index = lazyWithRetry(() => import('./pages/Index'));
const DashboardV2 = lazyWithRetry(() => import('./pages/DashboardV2'));
const AdminAlertsPage = lazyWithRetry(() => import('./pages/AdminAlerts'));
const UserManagementPage = lazyWithRetry(() => import('./pages/UserManagement'));
const DelegationsPage = lazyWithRetry(() => import('./pages/Delegations'));
const PermissionsManagement = lazyWithRetry(() => import('./pages/PermissionsManagement'));

// Lazy imports — heavy/secondary pages, split into their own chunks
// NOTE: Reports, ReportAssistant, AdminPerformance, AdminInterviewSupport and
// JobsListPage are temporarily hidden (nav + routes removed) — the team isn't
// using these surfaces. Page files remain on disk so this is reversible; just
// restore the import + matching <Route> below to bring a surface back.
// const Reports = lazyWithRetry(() => import('./pages/Reports'));
// const ReportAssistant = lazyWithRetry(() => import('./pages/ReportAssistant'));
const BranchCandidatesPage = lazyWithRetry(() => import('./pages/BranchCandidates'));
const ResumeUnderstanding = lazyWithRetry(() => import('./pages/ResumeUnderstanding'));
const ProfileHubPage = lazyWithRetry(() => import('./pages/ProfileHubPage'));
const CandidateDetailPage = lazyWithRetry(() => import('./pages/CandidateDetailPage'));
const TaskDetailPage = lazyWithRetry(() => import('./pages/TaskDetailPage'));
// const AdminPerformance = lazyWithRetry(() => import('./pages/AdminPerformance'));
// const AdminInterviewSupport = lazyWithRetry(() => import('./pages/AdminInterviewSupport'));
const JobsPage = lazyWithRetry(() => import('./pages/JobsPage'));
const CandidateJobsListPage = lazyWithRetry(() => import('./pages/CandidateJobsListPage'));
// const JobsListPage = lazyWithRetry(() => import('./pages/JobsListPage'));
const NotificationsPage = lazyWithRetry(() => import('./pages/NotificationsPage'));

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
                {/* Hidden — Reports surface removed from nav + routing (page file kept on disk) */}
                {/* <Route path="/reports" element={<Reports />} /> */}
                {/* <Route path="/reports/assistant" element={<ReportAssistant />} /> */}
                <Route path="/branch-candidates" element={<BranchCandidatesPage />} />
                <Route path="/admin-alerts" element={<AdminAlertsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/settings/notifications" element={<NotificationSettings />} />
                <Route path="/resume-understanding" element={<ResumeUnderstanding />} />
                <Route path="/user-management" element={<UserManagementPage />} />
                <Route path="/delegations" element={<DelegationsPage />} />
                <Route path="/permissions" element={<PermissionsManagement />} />
                <Route path="/dashboard-v2" element={<DashboardV2 />} />
                <Route path="/profile-hub" element={<ProfileHubPage />} />
                <Route path="/candidate/:id" element={<CandidateDetailPage />} />
                <Route path="/task/:taskId" element={<TaskDetailPage />} />
                {/* Hidden — frontend Performance Monitor page removed from nav + routing
                    (page file kept on disk; backend perf monitoring is unaffected) */}
                {/* <Route path="/admin/performance" element={<AdminPerformance />} /> */}
                {/* Hidden — Interview Support surface removed from nav + routing (page file kept on disk) */}
                {/* <Route path="/admin/interview-support" element={<AdminInterviewSupport />} /> */}
                {/* Hidden — Jobs Pool listing removed from nav + routing (page file kept on disk) */}
                {/* <Route path="/jobs" element={<JobsListPage />} /> */}
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
