import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set(['.git', '.tmp', 'node_modules', 'dist', 'coverage']);
const sourceExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

async function walk(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

function appNameFromPath(root, filename) {
  const parts = path.relative(root, filename).split(path.sep);
  return parts[0] === 'apps' && parts.length > 2 ? parts[1] : null;
}

export async function collectArchitectureViolations(root) {
  const files = await walk(root);
  const violations = [];
  const appPackageNames = new Map();

  for (const filename of files.filter((value) => path.basename(value) === 'package.json')) {
    const appName = appNameFromPath(root, filename);
    if (!appName) continue;
    const pkg = JSON.parse(await readFile(filename, 'utf8'));
    if (typeof pkg.name === 'string') appPackageNames.set(pkg.name, appName);
  }

  for (const filename of files.filter((value) => sourceExtension.test(value))) {
    const sourceApp = appNameFromPath(root, filename);
    if (!sourceApp) continue;
    const source = await readFile(filename, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      const packageTarget = appPackageNames.get(specifier);
      if (packageTarget && packageTarget !== sourceApp) {
        violations.push(`cross-app import: ${path.relative(root, filename)} -> ${specifier}`);
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const targetApp = appNameFromPath(root, path.resolve(path.dirname(filename), specifier));
      if (targetApp && targetApp !== sourceApp) {
        violations.push(`cross-app import: ${path.relative(root, filename)} -> ${specifier}`);
      }
    }
  }

  for (const filename of files) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    if (relative !== 'package-lock.json' && relative.endsWith('/package-lock.json')) {
      violations.push(`nested package-lock: ${relative}`);
    }
    if (path.basename(filename) === 'supabase_setup.sql') {
      violations.push(`legacy executable SQL: ${relative}`);
    }
  }

  const migrationAuthorities = new Set();
  for (const filename of files) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    const match = relative.match(/^(.*?supabase\/migrations)(?:\/|$)/);
    if (match) migrationAuthorities.add(match[1]);
  }
  for (const authority of migrationAuthorities) {
    if (authority !== 'supabase/migrations') {
      violations.push(`second Supabase migration authority: ${authority}`);
    }
  }

  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const menuPackage = JSON.parse(await readFile(path.join(root, 'apps/menu/package.json'), 'utf8'));
  if (!rootPackage.workspaces?.includes('apps/*')) violations.push('root workspaces must include apps/*');
  if (menuPackage.name !== '@tux/menu') violations.push('Menu workspace must be named @tux/menu');
  for (const script of ['build', 'typecheck', 'test:e2e:menu', 'test:monorepo-architecture']) {
    if (!rootPackage.scripts?.[script]) violations.push(`root script missing: ${script}`);
  }

  const ci = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  for (const command of [
    'npm run typecheck:menu',
    'npm run build:menu',
    'npm run test:e2e:menu',
    'npm run test:monorepo-architecture',
  ]) {
    if (!ci.includes(command)) violations.push(`CI coverage missing: ${command}`);
  }

  return violations.sort();
}

export async function assertMonorepoArchitecture(root) {
  const violations = await collectArchitectureViolations(root);
  if (violations.length > 0) {
    throw new Error(`Monorepo architecture violations:\n${violations.join('\n')}`);
  }
}
