import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { PostHogProvider } from 'posthog-js/react';
import App from './App.tsx';
import 'driver.js/dist/driver.css';
import './index.css';
import { msalInstance } from './authConfig';
import { attachChunkReloadHandler } from './utils/chunkReloadHandler';

// Auto-reload when stale dynamic-import chunks fail (post-deploy hygiene).
attachChunkReloadHandler();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element with id "root" not found');
}

const root = createRoot(container);

// [Harsh] PostHog Configuration
const posthogOptions = {
  api_host: 'https://us.i.posthog.com',
  defaults: '2025-11-30', // Updated value
  capture_exceptions: true,
  debug: import.meta.env.MODE === 'development',
  loaded: (posthog: any) => {
    if (import.meta.env.MODE === 'development')
      console.log('PostHog Initiated:', !!posthog);
  },
};

msalInstance
  .initialize()
  .then(() => {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }
    root.render(
      <MsalProvider instance={msalInstance}>
        <PostHogProvider
          apiKey={'phc_3e5ZCWNkfVdyMC846ZUyJavZt2T5GaYTgttkqK800tj'}
          options={posthogOptions}
        >
          <App />
        </PostHogProvider>
      </MsalProvider>
    );
  })
  .catch((error) => {
    console.error('Failed to initialize MSAL', error);
    root.render(<App />);
  });
