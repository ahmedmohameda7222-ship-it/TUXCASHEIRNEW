import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('TUX Admin application shell', () => {
  it('renders the Admin identity', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('TUX Admin');
  });
});
