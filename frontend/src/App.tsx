import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { ErrorBoundary } from './components/ErrorBoundary';

import SignIn from './pages/auth/SignIn';
import TasksToday from './pages/TasksToday';
import { Toaster } from './components/ui/toaster';
import { Toast } from './components/ui/toast';
import Index from './pages/Index';
import AuthorizedRoute from './routes/AuthorizedRoute';
import Reports from './pages/Reports';
import ReportAssistant from './pages/ReportAssistant';
import BranchCandidatesPage from './pages/BranchCandidates';
import AdminAlertsPage from './pages/AdminAlerts';
import UserManagementPage from './pages/UserManagement';
import ResumeUnderstanding from './pages/ResumeUnderstanding';
import DashboardV2 from './pages/DashboardV2';
import PermissionsManagement from './pages/PermissionsManagement';
import ProfileHubPage from './pages/ProfileHubPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import TaskDetailPage from './pages/TaskDetailPage';
import AdminPerformance from './pages/AdminPerformance';
import AdminInterviewSupport from './pages/AdminInterviewSupport';
import JobsPage from './pages/JobsPage';
import CandidateJobsListPage from './pages/CandidateJobsListPage';
import JobsListPage from './pages/JobsListPage';

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
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
            <Route path="/resume-understanding" element={<ResumeUnderstanding />} />
            <Route path="/user-management" element={<UserManagementPage />} />
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
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
