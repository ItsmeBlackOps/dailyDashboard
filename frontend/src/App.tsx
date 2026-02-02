import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@radix-ui/react-tooltip';

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

const queryClient = new QueryClient();

const App = () => (
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
            <Route path="/dashboard-v2" element={<DashboardV2 />} />
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
);

export default App;
