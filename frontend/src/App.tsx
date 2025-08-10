import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@radix-ui/react-tooltip';

import SignIn from './pages/auth/SignIn';
import TasksToday from './pages/TasksToday';
import { Toast } from './components/ui/toast';
import Index from './pages/Index';
import AuthorizedRoute from './routes/AuthorizedRoute';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth/signin" element={<SignIn />} />
          <Route path="/toast" element={<Toast />} />

          {/* Protected */}
          <Route element={<AuthorizedRoute />}>
            <Route path="/tasks" element={<TasksToday />} />
            {/* Add any other protected routes here */}
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
