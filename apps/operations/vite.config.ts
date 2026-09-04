import { defineConfig, type Plugin } from 'vite';

const emptyWhatsAppInbox = JSON.stringify({
  conversations: [],
  messages: [],
  quickReplies: [],
  orderLinks: [],
  nextCursor: null,
});

const browserFallbackApiPlugin: Plugin = {
  name: 'tux-e2e-browser-fallback-api',
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || requestUrl.pathname !== '/api/whatsapp') {
        next();
        return;
      }

      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      response.end(emptyWhatsAppInbox);
    });
  },
};

export default defineConfig({
  base: './',
  plugins: process.env['TUX_E2E_BROWSER_FALLBACK'] === '1' ? [browserFallbackApiPlugin] : [],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
