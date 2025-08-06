import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import SignIn from './pages/auth/SignIn';
import TasksToday from './pages/TasksToday';
import { Toast } from './components/ui/toast';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/signin" element={<SignIn />} />
          <Route path="/dashboard" element={<TasksToday />} />
          <Route path="/toast" element={<Toast />} />
          {/* Default to SignIn for any unmatched route */}
          <Route path="*" element={<SignIn />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
