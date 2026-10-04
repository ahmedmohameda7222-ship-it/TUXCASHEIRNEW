import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync('apps/operations/vercel.json', 'utf8'));

const expectedRewrites = [
  { source: '/api/device-bootstrap', destination: '/api/device?route=device-bootstrap' },
  { source: '/api/device-enroll', destination: '/api/device?route=device-enroll' },
  { source: '/api/device-session', destination: '/api/device?route=device-session' },
  { source: '/api/worker-auth', destination: '/api/worker?route=worker-auth' },
  { source: '/api/worker-menu-layout', destination: '/api/worker?route=worker-menu-layout' },
  {
    source: '/api/worker-ui-preferences',
    destination: '/api/worker?route=worker-ui-preferences',
  },
];

if (JSON.stringify(config.rewrites ?? []) !== JSON.stringify(expectedRewrites)) {
  throw new Error(
    `Operations Vercel rewrites must preserve the six consolidated public API routes. Expected ${JSON.stringify(expectedRewrites)}, got ${JSON.stringify(config.rewrites ?? [])}`,
  );
}

console.log('Operations Vercel consolidated route rewrites passed.');
