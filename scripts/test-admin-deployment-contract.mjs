import fs from 'node:fs';
import path from 'node:path';

const adminVercelPath = 'apps/admin/vercel.json';
const menuVercelPath = 'apps/menu/vercel.json';
const operationsVercelPath = 'apps/operations/vercel.json';
const operationsApiDir = 'apps/operations/api';
const rootApiDir = 'api';
const adminDeploymentDocPath = 'apps/admin/DEPLOYMENT.md';
const operationsDeploymentDocPath = 'apps/operations/DEPLOYMENT.md';
const adminExecutionLedgerPath = 'docs/superpowers/execution/2026-09-10-tux-admin-execution.md';

const adminConfig = JSON.parse(fs.readFileSync(adminVercelPath, 'utf8'));
const menuConfig = JSON.parse(fs.readFileSync(menuVercelPath, 'utf8'));
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

if (Object.prototype.hasOwnProperty.call(adminConfig, 'crons')) {
  throw new Error('Admin Vercel deployment contract must not register Cron Jobs');
}

// The repository root must not carry a Vercel project contract after Operations cutover.
if (fs.existsSync('vercel.json')) {
  throw new Error('Repository root vercel.json must be absent after Operations cutover');
}

// App-local Operations contract is the complete Operations deployment authority.
const expectedOperations = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'vite',
  installCommand: 'cd ../.. && npm ci',
  buildCommand: 'cd ../.. && npm run build -w @tux/operations',
  outputDirectory: 'dist',
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
  operationsConfig,
  expectedOperations,
  'App-local Operations Vercel deployment contract changed unexpectedly',
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

// Final deployment docs must describe isolated app-local project contracts.
for (const requiredText of [
  'repository root `/vercel.json` is absent',
  'Root Directory: `apps/admin`',
  'Include source files outside Root Directory',
  'cd ../.. && npm ci',
  'cd ../.. && npm run build:admin',
  'Output Directory: `dist`',
  'Final production acceptance is still Plan 10',
]) {
  if (!adminDeploymentDoc.includes(requiredText)) {
    throw new Error(`Admin deployment docs missing isolated-project statement: ${requiredText}`);
  }
}
for (const requiredText of [
  'Cutover status: complete',
  'Root Directory: `apps/operations`',
  'Include source files outside Root Directory',
  'cd ../.. && npm ci',
  'cd ../.. && npm run build -w @tux/operations',
  'Output Directory: `dist`',
  'dpl_9M6i179C83S6Hzry2rumFm9Tqx68',
  'repository-root `/vercel.json` is absent',
]) {
  if (!operationsDeploymentDoc.includes(requiredText)) {
    throw new Error(`Operations deployment docs missing completed-cutover statement: ${requiredText}`);
  }
}

for (const requiredLedgerText of [
  'Operations Vercel cutover was verified with production deployment `dpl_9M6i179C83S6Hzry2rumFm9Tqx68` in `READY` state',
  'The legacy root `/vercel.json` is removed',
  'Admin may now be created as a separate Vercel project rooted at `apps/admin`',
  'Final production acceptance remains gated by Plan 10',
]) {
  if (!adminExecutionLedger.includes(requiredLedgerText)) {
    throw new Error(
      `Admin execution ledger missing final deployment-policy reconciliation: ${requiredLedgerText}`,
    );
  }
}

if (
  adminExecutionLedger.includes(
    'Admin Vercel project must not be created until the existing Operations project is cut over',
  )
) {
  throw new Error('Admin execution ledger still contains the obsolete Vercel migration gate');
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

console.log('Admin/Menu/Operations Vercel isolation contracts passed.');
