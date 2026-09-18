import fs from 'node:fs';
import path from 'node:path';

const adminVercelPath = 'apps/admin/vercel.json';
const menuVercelPath = 'apps/menu/vercel.json';
const operationsVercelPath = 'vercel.json';
const adminDeploymentDocPath = 'apps/admin/DEPLOYMENT.md';
const cronDir = 'apps/admin/api/cron';

const adminConfig = JSON.parse(fs.readFileSync(adminVercelPath, 'utf8'));
const menuConfig = JSON.parse(fs.readFileSync(menuVercelPath, 'utf8'));
const operationsConfig = JSON.parse(fs.readFileSync(operationsVercelPath, 'utf8'));
const adminDeploymentDoc = fs.readFileSync(adminDeploymentDocPath, 'utf8');

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// Admin is a separate Vercel project rooted at apps/admin. Its app-local config
// must remain authoritative and must never build the Operations workspace.
assertEqual(adminConfig.framework, 'vite', 'Admin Vercel framework');
assertEqual(adminConfig.installCommand, 'cd ../.. && npm ci', 'Admin Vercel install command');
assertEqual(
  adminConfig.buildCommand,
  'cd ../.. && npm run build:admin',
  'Admin Vercel build command',
);
if (adminConfig.buildCommand.toLowerCase().includes('operations')) {
  throw new Error('Admin Vercel build command must not build @tux/operations');
}
assertEqual(
  adminConfig.outputDirectory,
  'dist',
  'Admin Vercel output must be relative to apps/admin',
);

assertJsonEqual(
  adminConfig.git?.deploymentEnabled,
  {
    '**': false,
    main: true,
  },
  'Admin Git deployment policy must deploy main only',
);
if (Object.prototype.hasOwnProperty.call(adminConfig.git?.deploymentEnabled ?? {}, '*')) {
  throw new Error('Admin Git deployment policy must use **, never *');
}

// File-system/API routing must happen before the SPA fallback so /api/* and
// cron functions remain serverless routes rather than index.html.
const adminRoutes = Array.isArray(adminConfig.routes) ? adminConfig.routes : [];
if (adminRoutes.length < 2 || adminRoutes[0]?.handle !== 'filesystem') {
  throw new Error('Admin Vercel routes must preserve filesystem/API routes before SPA fallback');
}
const spaFallback = adminRoutes.at(-1);
assertEqual(spaFallback?.src, '/(.*)', 'Admin SPA fallback source');
assertEqual(spaFallback?.dest, '/index.html', 'Admin SPA fallback destination');

const crons = Array.isArray(adminConfig.crons) ? adminConfig.crons : [];
const expected = new Map([
  ['/api/cron/admin-config-scheduler', '* * * * *'],
  ['/api/cron/admin-approval-executor', '* * * * *'],
]);

for (const [routePath, schedule] of expected) {
  const matches = crons.filter((entry) => entry?.path === routePath);
  if (matches.length !== 1 || matches[0]?.schedule !== schedule) {
    throw new Error(`Admin cron deployment contract missing ${routePath} @ ${schedule}`);
  }
}

const routeFiles = fs
  .readdirSync(cronDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => entry.name)
  .sort();

for (const fileName of routeFiles) {
  const routePath = `/api/cron/${fileName.slice(0, -3)}`;
  const matches = crons.filter((entry) => entry?.path === routePath);
  if (matches.length !== 1) {
    throw new Error(`Admin cron route ${routePath} must have exactly one Vercel schedule`);
  }
}

const schedulerSource = fs.readFileSync(path.join(cronDir, 'admin-config-scheduler.ts'), 'utf8');
if (!schedulerSource.includes('handleCatalogSchedulerRequest')) {
  throw new Error('Admin config scheduler route must use the shared scheduler auth handler');
}
if (!schedulerSource.includes("process.env['CRON_SECRET']")) {
  throw new Error('Admin config scheduler route must use the CRON_SECRET deployment contract');
}

// Preserve the existing Operations project contract byte-for-byte semantically.
// It intentionally remains the repository-root Vercel project because its API
// functions also live at repository-root /api.
assertJsonEqual(
  operationsConfig,
  {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: 'vite',
    installCommand: 'npm ci',
    buildCommand: 'npm run build -w @tux/operations',
    outputDirectory: 'apps/operations/dist',
    crons: [
      {
        path: '/api/whatsapp-media-retention',
        schedule: '17 3 * * *',
      },
    ],
    git: {
      deploymentEnabled: {
        '**': false,
        main: true,
      },
    },
    ignoreCommand:
      'if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi',
  },
  'Operations Vercel deployment contract changed unexpectedly',
);

// Preserve the proven Menu app-local deployment boundary.
assertEqual(menuConfig.framework, 'vite', 'Menu Vercel framework');
assertEqual(menuConfig.installCommand, 'cd ../.. && npm ci', 'Menu Vercel install command');
assertEqual(menuConfig.buildCommand, 'cd ../.. && npm run build:menu', 'Menu Vercel build command');
assertEqual(menuConfig.outputDirectory, 'dist', 'Menu Vercel output directory');
assertJsonEqual(
  menuConfig.git?.deploymentEnabled,
  {
    '**': false,
    main: true,
  },
  'Menu Git deployment policy',
);

for (const requiredText of [
  'separate Vercel project',
  'main',
  'PR previews remain disabled',
  'Plan 10',
]) {
  if (!adminDeploymentDoc.includes(requiredText)) {
    throw new Error(`Admin deployment docs missing required statement: ${requiredText}`);
  }
}

console.log('Admin/Menu/Operations Vercel deployment contracts passed.');
