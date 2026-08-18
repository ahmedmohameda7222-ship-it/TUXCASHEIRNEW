import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@tux/ui/tokens.css';
import './styles/global.css';
import './styles/orders.css';
import './styles/orders-board.css';
import { App } from './app/App';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('TUX Operations root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
