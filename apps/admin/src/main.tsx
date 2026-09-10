import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import App from './app/App';
import { queryClient } from './app/queryClient';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('TUX Admin root element is missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  </StrictMode>,
);
