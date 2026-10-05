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

// Vercel executes Admin API functions as Node ESM. Relative production imports
// must include a runtime extension so transpiled .js files resolve under Node.
for (const directory of ['apps/admin/api', 'apps/admin/server']) {
  for (const fileName of collectTsFiles(directory)) {
    if (fileName.endsWith('.test.ts') || fileName.includes('.source.test.')) continue;
    const absolutePath = path.join(directory, fileName);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const relativeSpecifiers = [
      ...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g),
    ]
      .map((match) => match[1])
      .filter((specifier) => specifier?.startsWith('.'));
    for (const specifier of relativeSpecifiers) {
      if (!/\.(?:js|mjs|cjs|json)$/.test(specifier)) {
        throw new Error(
          `Admin Node ESM production import must include a runtime extension: ${absolutePath} -> ${specifier}`,
        );
      }
    }
  }
}

// Admin Serverless Functions must not runtime-import the source-only
// @tux/admin-contracts workspace package. Type-only imports are erased safely.
for (const directory of ['apps/admin/api', 'apps/admin/server']) {
  for (const fileName of collectTsFiles(directory)) {
    if (fileName.endsWith('.test.ts') || fileName.includes('.source.test.')) continue;
    const absolutePath = path.join(directory, fileName);
    const source = fs.readFileSync(absolutePath, 'utf8');
    if (/import\s+(?!type\b)[^;]*?from\s+['"]@tux\/admin-contracts['"]/gs.test(source)) {
      throw new Error(
        `Admin Vercel runtime code must use @tux/admin-contracts only through type-only imports: ${absolutePath}`,
      );
    }
  }
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
  functions: {
    'api/whatsapp*.ts': {
      includeFiles: [
        '../../packages/domain/package.json',
        '../../packages/domain/src/**',
        '../../packages/application/package.json',
        '../../packages/application/src/whatsapp*.ts',
      ],
    },
  },
  rewrites: [
    { source: '/api/device-bootstrap', destination: '/api/device?route=device-bootstrap' },
    { source: '/api/device-enroll', destination: '/api/device?route=device-enroll' },
    { source: '/api/device-session', destination: '/api/device?route=device-session' },
    { source: '/api/worker-auth', destination: '/api/worker?route=worker-auth' },
    {
      source: '/api/worker-menu-layout',
      destination: '/api/worker?route=worker-menu-layout',
    },
    {
      source: '/api/worker-ui-preferences',
      destination: '/api/worker?route=worker-ui-preferences',
    },
  ],
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

const adminApiFiles = collectTsFiles('apps/admin/api');
if (adminApiFiles.length > 12) {
  throw new Error(
    `Admin Vercel deployment exceeds the Hobby Serverless Function limit: ${adminApiFiles.length} > 12`,
  );
}
const adminApiTestFiles = adminApiFiles.filter((fileName) => fileName.endsWith('.test.ts'));
if (adminApiTestFiles.length > 0) {
  throw new Error(
    `Admin test files must live outside apps/admin/api so Vercel does not deploy them as Functions: ${adminApiTestFiles.join(', ')}`,
  );
}
const adminCronApiFiles = adminApiFiles.filter((fileName) => fileName.startsWith('cron/'));
if (adminCronApiFiles.length > 0) {
  throw new Error(
    `Admin Cron entrypoints must not be deployed from apps/admin/api: ${adminCronApiFiles.join(', ')}`,
  );
}

const operationsApiFiles = collectTsFiles(operationsApiDir);
const operationsApiTestFiles = operationsApiFiles.filter((fileName) => fileName.endsWith('.test.ts'));
if (operationsApiTestFiles.length > 0) {
  throw new Error(
    `Operations test files must live outside apps/operations/api so Vercel does not deploy them as Functions: ${operationsApiTestFiles.join(', ')}`,
  );
}
if (operationsApiFiles.length > 12) {
  throw new Error(
    `Operations Vercel deployment exceeds the Hobby Serverless Function limit: ${operationsApiFiles.length} > 12`,
  );
}

const rootApiFiles = collectTsFiles(rootApiDir).filter((fileName) => !fileName.endsWith('.test.ts'));
const consolidatedRootApiFiles = new Set([
  'device-bootstrap.ts',
  'device-enroll.ts',
  'device-session.ts',
  'worker-auth.ts',
  'worker-menu-layout.ts',
  'worker-ui-preferences.ts',
]);
const requiredOperationsWrappers = rootApiFiles.filter(
  (fileName) => !consolidatedRootApiFiles.has(fileName),
);
for (const fileName of requiredOperationsWrappers) {
  const wrapperPath = path.join(operationsApiDir, fileName);
  if (!fs.existsSync(wrapperPath)) {
    throw new Error(`Missing app-local Operations API wrapper for root API handler: ${fileName}`);
  }
  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8').trim();
  const relativeRootHandler = path
    .relative(path.dirname(wrapperPath), path.join(rootApiDir, fileName))
    .split(path.sep)
    .join('/')
    .replace(/\.ts$/, '.js');
  const expectedWrapper = `export { default } from '${relativeRootHandler.startsWith('.') ? relativeRootHandler : `./${relativeRootHandler}`}';`;
  if (wrapperSource !== expectedWrapper) {
    throw new Error(
      `Operations API wrapper must delegate only to the canonical root handler: ${wrapperPath}`,
    );
  }
}

for (const [dispatcherFile, expectedRoutes] of [
  [
    'device.ts',
    ['device-bootstrap', 'device-enroll', 'device-session'],
  ],
  [
    'worker.ts',
    ['worker-auth', 'worker-menu-layout', 'worker-ui-preferences'],
  ],
]) {
  const source = fs.readFileSync(path.join(operationsApiDir, dispatcherFile), 'utf8');
  for (const route of expectedRoutes) {
    const relativeRootHandler = path
      .relative(operationsApiDir, path.join(rootApiDir, `${route}.ts`))
      .split(path.sep)
      .join('/')
      .replace(/\.ts$/, '.js');
    const expectedImport = relativeRootHandler.startsWith('.')
      ? relativeRootHandler
      : `./${relativeRootHandler}`;
    if (!source.includes(`'${expectedImport}'`) && !source.includes(`"${expectedImport}"`)) {
      throw new Error(
        `Operations ${dispatcherFile} must import canonical root handler ${route} using Node ESM-safe .js specifier.`,
      );
    }
  }
}

if (!apiTsconfig.include?.includes('apps/admin/api/**/*.ts')) {
  throw new Error('API typecheck must include apps/admin/api/**/*.ts');
}

if (!adminFoundationWorkflow.includes('npm run test:admin-deployment')) {
  throw new Error('Admin Foundation TDD must execute the Admin deployment contract test');
}

for (const requirement of [
  'apps/admin',
  'Root Directory',
  'Production Branch',
  'main',
  'apps/admin/vercel.json',
  'cd ../.. && npm ci',
  'npm run build:admin',
]) {
  if (!adminDeploymentDoc.includes(requirement)) {
    throw new Error(`Admin deployment doc missing required contract token: ${requirement}`);
  }
}
if (/deploys the Vite frontend only/i.test(adminDeploymentDoc)) {
  throw new Error('Admin deployment doc must describe the Admin API functions as part of deployment');
}

for (const requirement of [
  'apps/operations',
  'Root Directory',
  'Production Branch',
  'main',
  'apps/operations/vercel.json',
  'cd ../.. && npm ci',
  'npm run build -w @tux/operations',
]) {
  if (!operationsDeploymentDoc.includes(requirement)) {
    throw new Error(`Operations deployment doc missing required contract token: ${requirement}`);
  }
}

if (!adminExecutionLedger.includes('apps/admin/vercel.json')) {
  throw new Error('Admin execution ledger must record the app-local Vercel deployment contract');
}
if (!adminExecutionLedger.includes('apps/admin')) {
  throw new Error('Admin execution ledger must record the Admin Vercel Root Directory');
}

console.log('Admin Vercel deployment contract is complete.');
