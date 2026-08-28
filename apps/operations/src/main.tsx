import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@tux/ui/tokens.css';
import './styles/global.css';
import './styles/orders.css';
import './styles/orders-board.css';
import './styles/expenses.css';
import './styles/bulk-stock.css';
import './styles/end-day.css';
import './styles/premium.css';
import './styles/brand.css';
import './styles/responsive-safe-area.css';
import './styles/final-pos-corrections.css';
import './styles/system-color-picker.css';
import { BrowserBootstrapGate } from './app/BrowserBootstrapGate';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('TUX Operations root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserBootstrapGate />
  </StrictMode>,
);
