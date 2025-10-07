import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import App from './App.tsx';
import 'driver.js/dist/driver.css';
import './index.css';
import { msalInstance } from './authConfig';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element with id "root" not found');
}

const root = createRoot(container);

msalInstance
  .initialize()
  .then(() => {
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(accounts[0]);
    }
    root.render(
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    );
  })
  .catch((error) => {
    console.error('Failed to initialize MSAL', error);
    root.render(<App />);
  });
