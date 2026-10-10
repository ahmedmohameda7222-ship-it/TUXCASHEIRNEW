import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Tests must execute the current domain source after local edits, not the
// compiled dist artifact created during npm ci. The production/Node package
// export remains dist/index.js; only the Vitest resolver opts into source.
export default defineConfig({
  resolve: {
    conditions: ['tux-vitest-source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['tux-vitest-source', ...defaultServerConditions],
    },
  },
});
