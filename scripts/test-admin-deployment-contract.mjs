import fs from 'node:fs';
import path from 'node:path';

const adminVercelPath = 'apps/admin/vercel.json';
const menuVercelPath = 'apps/menu/vercel.json';
const legacyOperationsVercelPath = 'vercel.json';
const operationsVercelPath = 'apps/operations/vercel.json';
const operationsApiDir = 'apps/operations/api';
const rootApiDir = 'api';
const adminDeploymentDocPath = 'apps/admin/DEPLOYMENT.md';
const operationsDeploymentDocPath = 'apps/operations/DEPLOYMENT.md';
const adminExecutionLedgerPath = 'docs/superpowers/execution/2026-09-10-tux-admin-execution.md';
const cronDir = 'apps/admin/api/cron';

const adminConfig = JSON.parse(fs.readFileSync(adminVercelPath, 'utf8'));
const menuConfig = JSON.parse(fs.readFileSync(menuVercelPath, 'utf8'));
const legacyOperationsConfig = JSON.parse(fs.readFileSync(legacyOperationsVercelPath, 'utf8'));
const operationsConfig = JSON.parse(fs.readFileSync(operationsVercelPath, 'utf8'));
const adminDeploymentDoc = fs.readFileSync(adminDeploymentDocPath, 'utf8');
const operationsDeploymentDoc = fs.readFileSync(operationsDeploymentDocPath, 'utf8');
const adminExecutionLedger = fs.readFileSync(adminExecutionLedgerPath, 'utf8');
const adminFoundationWorkflow = fs.readFileSync(
  '.github/workflows/admin-foundation-tdd.yml',
  'utf8',
);
const apiTsconfig = JSON.parse(fs.readFileSync('tsconfig.api.json', 'utf8'));

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

// Admin target contract.
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
assertEqual(adminConfig.outputDirectory, 'dist', 'Admin Vercel output directory');
assertJsonEqual(
  adminConfig.git?.deploymentEnabled,
  { '**': false, main: true },
  'Admin Git deployment policy must deploy main only',
);
if (Object.prototype.hasOwnProperty.call(adminConfig.git?.deploymentEnabled ?? {}, '*')) {
  throw new Error('Admin Git deployment policy must use **, never *');
}

// File-system/API routing must happen before the SPA fallback.
const adminRoutes = Array.isArray(adminConfig.routes) ? adminConfig.routes : [];
if (adminRoutes.length < 2 || adminRoutes[0]?.handle !== 'filesystem') {
  throw new Error('Admin Vercel routes must preserve filesystem/API routes before SPA fallback');
}
const spaFallback = adminRoutes.at(-1);
assertEqual(spaFallback?.src, '/(.*)', 'Admin SPA fallback source');
assertEqual(spaFallback?.dest, '/index.html', 'Admin SPA fallback destination');

const crons = Array.isArray(adminConfig.crons) ? adminConfig.crons : [];
const expectedAdminCrons = new Map([
  ['/api/cron/admin-config-scheduler', '* * * * *'],
  ['/api/cron/admin-approval-executor', '* * * * *'],
]);
for (const [routePath, schedule] of expectedAdminCrons) {
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

// Preserve the live legacy Operations project contract until the manual cutover is verified.
const expectedLegacyOperations = {
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
};
assertJsonEqual(
  legacyOperationsConfig,
  expectedLegacyOperations,
  'Live legacy Operations Vercel deployment contract changed unexpectedly',
);

// App-local Operations contract must be functionally equivalent after Root Directory moves.
assertJsonEqual(
  operationsConfig,
  {
    ...expectedLegacyOperations,
    installCommand: 'cd ../.. && npm ci',
    buildCommand: 'cd ../.. && npm run build -w @tux/operations',
    outputDirectory: 'dist',
  },
  'App-local Operations Vercel deployment contract is not equivalent',
);
if (operationsConfig.buildCommand.toLowerCase().includes('admin')) {
  throw new Error('Operations Vercel build command must not build Admin');
}

// Every live root API function, including nested filesystem routes, must have an
// app-local Vercel function entrypoint.
function collectTsFiles(directory, baseDirectory = directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTsFiles(absolutePath, baseDirectory);
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        return [];
      }
      return [path.relative(baseDirectory, absolutePath).split(path.sep).join('/')];
    })
    .sort();
}

const rootApiFiles = collectTsFiles(rootApiDir);
const operationsApiFiles = collectTsFiles(operationsApiDir);
assertJsonEqual(
  operationsApiFiles,
  rootApiFiles,
  'Operations app-local API entrypoints must mirror every root API function recursively',
);
for (const fileName of rootApiFiles) {
  const wrapperPath = path.join(operationsApiDir, fileName);
  const source = fs.readFileSync(wrapperPath, 'utf8').trim();
  const rootModulePath = path.join(rootApiDir, fileName.slice(0, -3));
  let relativeImport = path
    .relative(path.dirname(wrapperPath), rootModulePath)
    .split(path.sep)
    .join('/');
  if (!relativeImport.startsWith('.')) {
    relativeImport = `./${relativeImport}`;
  }
  assertEqual(
    source,
    `export { default } from '${relativeImport}';`,
    `Operations API entrypoint ${fileName}`,
  );
}

if (!apiTsconfig.include?.includes('apps/operations/api/**/*.ts')) {
  throw new Error('Root API typecheck must include apps/operations/api/**/*.ts');
}

// Preserve the proven Menu app-local deployment boundary.
assertEqual(menuConfig.framework, 'vite', 'Menu Vercel framework');
assertEqual(menuConfig.installCommand, 'cd ../.. && npm ci', 'Menu Vercel install command');
assertEqual(menuConfig.buildCommand, 'cd ../.. && npm run build:menu', 'Menu Vercel build command');
assertEqual(menuConfig.outputDirectory, 'dist', 'Menu Vercel output directory');
assertJsonEqual(
  menuConfig.git?.deploymentEnabled,
  { '**': false, main: true },
  'Menu Git deployment policy',
);

// Migration docs must not claim Admin import isolation is complete while the legacy root contract exists.
for (const requiredText of [
  'do not create the Admin project until',
  'legacy root',
  'apps/operations',
  'Plan 10',
]) {
  if (!adminDeploymentDoc.includes(requiredText)) {
    throw new Error(`Admin deployment docs missing migration statement: ${requiredText}`);
  }
}
for (const requiredText of [
  'Root Directory: `apps/operations`',
  'Include source files outside Root Directory',
  'cd ../.. && npm ci',
  'cd ../.. && npm run build -w @tux/operations',
  'Output Directory: `dist`',
  'Only after that verification may the legacy repository-root `/vercel.json` be removed',
]) {
  if (!operationsDeploymentDoc.includes(requiredText)) {
    throw new Error(`Operations deployment docs missing cutover statement: ${requiredText}`);
  }
}

for (const requiredLedgerText of [
  'Admin Vercel project must not be created until the existing Operations project is cut over to Root Directory `apps/operations`',
  'legacy root `/vercel.json` is removed after successful production verification',
  'Final production acceptance remains gated by Plan 10',
]) {
  if (!adminExecutionLedger.includes(requiredLedgerText)) {
    throw new Error(
      `Admin execution ledger missing deployment-policy reconciliation: ${requiredLedgerText}`,
    );
  }
}

if (adminExecutionLedger.includes('The separate Admin Vercel project is rooted at `apps/admin`')) {
  throw new Error('Admin execution ledger still claims the gated Admin Vercel project already exists');
}

for (const requiredWorkflowPath of [
  "      - 'vercel.json'",
  "      - 'apps/menu/vercel.json'",
  "      - 'apps/operations/**'",
  "      - 'api/**'",
]) {
  if (!adminFoundationWorkflow.includes(requiredWorkflowPath)) {
    throw new Error(
      `Admin Foundation deployment contract must trigger when ${requiredWorkflowPath.trim()} changes`,
    );
  }
}

console.log('Admin/Menu/Operations Vercel migration contracts passed.');
