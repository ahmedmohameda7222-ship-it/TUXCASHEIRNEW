import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

// Parse actual TypeScript module syntax. String checks miss named mixed type/value
// imports, side-effect imports, re-exports and lazy import() expressions.
const adminManifest = JSON.parse(fs.readFileSync('apps/admin/package.json', 'utf8'));
const bundledSourcePatterns = adminConfig.functions?.['api/**/*.ts']?.includeFiles;
const includes = Array.isArray(bundledSourcePatterns)
  ? bundledSourcePatterns
  : typeof bundledSourcePatterns === 'string'
    ? [bundledSourcePatterns]
    : [];

function assertRuntimeWorkspaceImport(specifier, sourcePath) {
  if (!specifier.startsWith('@tux/')) return;
  const match = /^(@tux\/[^/]+)/.exec(specifier);
  if (!match) throw new Error(`Invalid workspace import: ${specifier}`);
  const packageName = match[1];
  if (packageName === '@tux/admin-contracts') {
    throw new Error(`Runtime import of type-only Admin contracts: ${sourcePath}`);
  }
  if (!Object.hasOwn(adminManifest.dependencies ?? {}, packageName)) {
    throw new Error(`Undeclared Admin runtime workspace dependency ${packageName}: ${sourcePath}`);
  }
  const packageDirectory = packageName.slice('@tux/'.length);
  const manifestFile = `packages/${packageDirectory}/package.json`;
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`Unknown Admin runtime workspace package: ${packageName}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const exportsSource = JSON.stringify(manifest.exports ?? {});
  if (exportsSource.includes('/src/') || exportsSource.includes('.ts')) {
    const expected = `../../packages/${packageDirectory}/src/**`;
    if (!includes.includes(expected)) {
      throw new Error(`Missing Admin Vercel runtime source packaging for ${packageName}: ${expected}`);
    }
  }
}

function isRuntimeImportClause(clause) {
  if (!clause || clause.isTypeOnly) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  return !bindings || ts.isNamespaceImport(bindings) ||
    bindings.elements.some((element) => !element.isTypeOnly);
}

for (const directory of ['apps/admin/api', 'apps/admin/server']) {
  for (const fileName of collectTsFiles(directory)) {
    if (fileName.endsWith('.test.ts') || fileName.includes('.source.test.')) continue;
    const filePath = path.join(directory, fileName);
    const ast = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
          isRuntimeImportClause(node.importClause)) {
        assertRuntimeWorkspaceImport(node.moduleSpecifier.text, filePath);
      }
      if (ts.isExportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
          !node.isTypeOnly &&
          (!node.exportClause || !ts.isNamedExports(node.exportClause) ||
            node.exportClause.elements.some((element) => !element.isTypeOnly))) {
        assertRuntimeWorkspaceImport(node.moduleSpecifier.text, filePath);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assertRuntimeWorkspaceImport(node.arguments[0].text, filePath);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
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
    'api/**/*.ts': {
      includeFiles: '../../packages/{domain,application}/src/**',
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
    `Admin Vercel cron endpoints must be absent while Cron Jobs are disabled: ${adminCronApiFiles.join(', ')}`,
  );
}

const rootApiFiles = collectTsFiles(rootApiDir);
const operationsApiFiles = collectTsFiles(operationsApiDir);
const consolidatedOperationsRoutes = {
  'device.ts': ['device-bootstrap.ts', 'device-enroll.ts', 'device-session.ts'],
  'worker.ts': ['worker-auth.ts', 'worker-menu-layout.ts', 'worker-ui-preferences.ts'],
};
const consolidatedRootApiFiles = new Set(Object.values(consolidatedOperationsRoutes).flat());
const passthroughRootApiFiles = rootApiFiles.filter(
  (fileName) => !consolidatedRootApiFiles.has(fileName),
);
const expectedOperationsApiFiles = [
  ...passthroughRootApiFiles,
  ...Object.keys(consolidatedOperationsRoutes),
].sort();

assertJsonEqual(
  operationsApiFiles,
  expectedOperationsApiFiles,
  'Operations app-local API entrypoints must preserve passthrough routes and approved dispatchers',
);
if (operationsApiFiles.length > 12) {
  throw new Error(
    `Operations Vercel deployment exceeds the Hobby Serverless Function limit: ${operationsApiFiles.length} > 12`,
  );
}

for (const fileName of passthroughRootApiFiles) {
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
    `export { default } from '${relativeImport}.js';`,
    `Operations API entrypoint ${fileName}`,
  );
}

for (const [dispatcherFile, routedFiles] of Object.entries(consolidatedOperationsRoutes)) {
  const source = fs.readFileSync(path.join(operationsApiDir, dispatcherFile), 'utf8');
  for (const routedFile of routedFiles) {
    const routeName = routedFile.slice(0, -3);
    if (!source.includes(`../../../api/${routeName}.js`)) {
      throw new Error(
        `Operations dispatcher ${dispatcherFile} must import root handler ${routeName} with an explicit .js runtime extension`,
      );
    }
    if (!source.includes(`'${routeName}'`)) {
      throw new Error(
        `Operations dispatcher ${dispatcherFile} must route key ${routeName}`,
      );
    }
  }
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
