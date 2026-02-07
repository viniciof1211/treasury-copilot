import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CopilotKit } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';
import App from './App.tsx';
import './index.css';

const publicApiKey = import.meta.env.VITE_COPILOT_CLOUD_API_KEY;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CopilotKit publicApiKey={publicApiKey || undefined}>
      <App />
    </CopilotKit>
  </StrictMode>
);
