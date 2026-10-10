import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OPERATIONS_API_DIR = path.join(ROOT, 'apps', 'operations', 'api');
const PACKAGES_DIR = path.join(ROOT, 'packages');
// Native workspace source is traced through emitted .js specifiers at the Vercel boundary.
const packageTypeCache = new Map();

function collectTsFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTsFiles(absolutePath);
      return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
    })
    .sort();
}

function workspacePackages() {
  const packages = new Map();
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join(PACKAGES_DIR, entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (typeof manifest.name !== 'string') continue;
    const rootExport =
      typeof manifest.exports === 'string'
        ? manifest.exports
        : manifest.exports && typeof manifest.exports['.'] === 'string'
          ? manifest.exports['.']
          : null;
    packages.set(manifest.name, {
      sourceOnlyRuntimeExport: typeof rootExport === 'string' && rootExport.endsWith('.ts'),
      rootExport,
    });
  }
  return packages;
}

function moduleReferences(source) {
  const references = [];
  const staticPattern = /\b(import|export)\s+(type\s+)?(?:[^;]*?\bfrom\s*)?['\"]([^'\"]+)['\"]/g;
  const dynamicPattern = /\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

  for (const match of source.matchAll(staticPattern)) {
    if (!match[3]) continue;
    references.push({ specifier: match[3], typeOnly: Boolean(match[2]) });
  }
  for (const match of source.matchAll(dynamicPattern)) {
    if (match[1]) references.push({ specifier: match[1], typeOnly: false });
  }
  return references;
}

function repositoryPath(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function packageTypeFor(file) {
  let directory = path.dirname(file);
  while (directory.startsWith(ROOT)) {
    if (packageTypeCache.has(directory)) return packageTypeCache.get(directory);
    const packageJson = path.join(directory, 'package.json');
    if (fs.existsSync(packageJson)) {
      const parsed = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
      const packageType = parsed.type === 'module' ? 'module' : 'commonjs';
      packageTypeCache.set(directory, packageType);
      return packageType;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return 'commonjs';
}

function resolveSource(importer, specifier) {
  const resolved = path.resolve(path.dirname(importer), specifier);
  if (specifier.endsWith('.ts')) {
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `${repositoryPath(importer)} imports ${specifier}, but ${repositoryPath(resolved)} does not exist.`,
      );
    }
    return resolved;
  }

  if (specifier.endsWith('.js')) {
    const tsSource = `${resolved.slice(0, -3)}.ts`;
    if (fs.existsSync(tsSource)) return tsSource;
    if (fs.existsSync(resolved)) return null;
    throw new Error(
      `${repositoryPath(importer)} imports ${specifier}, but neither ${repositoryPath(tsSource)} nor ${repositoryPath(resolved)} exists.`,
    );
  }

  if (specifier.endsWith('.mjs') || specifier.endsWith('.cjs') || specifier.endsWith('.json')) {
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `${repositoryPath(importer)} imports ${specifier}, but ${repositoryPath(resolved)} does not exist.`,
      );
    }
    return null;
  }

  for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function workspacePackageForSpecifier(specifier, packages) {
  for (const [packageName, manifest] of packages) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
      return { packageName, manifest };
    }
  }
  return null;
}

function isVercelBoundaryFile(file) {
  const relative = repositoryPath(file);
  return (
    relative.startsWith('api/') ||
    relative.startsWith('server/') ||
    relative.startsWith('apps/operations/api/')
  );
}

const packages = workspacePackages();
const queue = collectTsFiles(OPERATIONS_API_DIR);
const visited = new Set();
const relativeViolations = [];
const workspaceRuntimeViolations = [];
const rawTsRuntimeViolations = [];

while (queue.length > 0) {
  const file = queue.shift();
  if (!file || visited.has(file)) continue;
  visited.add(file);

  const source = fs.readFileSync(file, 'utf8');
  const isEsmPackage = packageTypeFor(file) === 'module';
  for (const reference of moduleReferences(source)) {
    const { specifier, typeOnly } = reference;
    if (!specifier.startsWith('.')) {
      if (typeOnly) continue;
      const workspacePackage = workspacePackageForSpecifier(specifier, packages);
      if (workspacePackage?.manifest.sourceOnlyRuntimeExport) {
        workspaceRuntimeViolations.push(
          `${repositoryPath(file)} -> ${specifier} (${workspacePackage.packageName} exports ${workspacePackage.manifest.rootExport})`,
        );
      }
      continue;
    }

    const hasExplicitRuntimeExtension =
      specifier.endsWith('.ts') ||
      specifier.endsWith('.js') ||
      specifier.endsWith('.mjs') ||
      specifier.endsWith('.cjs') ||
      specifier.endsWith('.json');
    if (isEsmPackage && !hasExplicitRuntimeExtension) {
      relativeViolations.push(`${repositoryPath(file)} -> ${specifier}`);
    }
    if (!typeOnly && isVercelBoundaryFile(file) && specifier.endsWith('.ts')) {
      rawTsRuntimeViolations.push(`${repositoryPath(file)} -> ${specifier}`);
    }

    const resolvedSource = resolveSource(file, specifier);
    if (resolvedSource !== null && !visited.has(resolvedSource)) queue.push(resolvedSource);
  }
}

if (
  relativeViolations.length > 0 ||
  workspaceRuntimeViolations.length > 0 ||
  rawTsRuntimeViolations.length > 0
) {
  const sections = [];
  if (relativeViolations.length > 0) {
    sections.push(
      `Node ESM-unsafe relative imports inside type=module packages. Use explicit runtime extensions (.js for compiled modules or .ts for native source modules):\n${relativeViolations
        .sort()
        .map((violation) => `- ${violation}`)
        .join('\n')}`,
    );
  }
  if (workspaceRuntimeViolations.length > 0) {
    sections.push(
      `Runtime imports from source-only workspace packages are unsafe in Vercel Functions. Keep package imports type-only and route runtime values through traceable relative modules:\n${workspaceRuntimeViolations
        .sort()
        .map((violation) => `- ${violation}`)
        .join('\n')}`,
    );
  }
  if (rawTsRuntimeViolations.length > 0) {
    sections.push(
      `Raw .ts runtime imports from Vercel boundary modules are not deployable Lambda paths. Import TypeScript source through emitted .js specifiers so Vercel traces and compiles it:\n${rawTsRuntimeViolations
        .sort()
        .map((violation) => `- ${violation}`)
        .join('\n')}`,
    );
  }
  throw new Error(
    `Operations Vercel serverless graph is not runtime-safe:\n${sections.join('\n\n')}`,
  );
}

const smokeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tux-vercel-runtime-'));
const smokeConfig = path.join(ROOT, `.workspaceRuntime-smoke-${process.pid}.json`);
try {
  fs.writeFileSync(
    smokeConfig,
    `${JSON.stringify(
      {
        extends: './apps/operations/tsconfig.vercel.json',
        compilerOptions: {
          noEmit: false,
          noEmitOnError: true,
          outDir: smokeDirectory,
          rootDir: '.',
          rewriteRelativeImportExtensions: true,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
          incremental: false,
        },
        files: ['server/workspaceRuntime.ts'],
        include: [],
      },
      null,
      2,
    )}\n`,
  );

  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', smokeConfig, '--pretty', 'false'], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  fs.writeFileSync(path.join(smokeDirectory, 'package.json'), '{"type":"module"}\n');
  const emittedAdapter = path.join(smokeDirectory, 'server', 'workspaceRuntime.js');
  if (!fs.existsSync(emittedAdapter)) {
    throw new Error(`Expected emitted runtime adapter at ${emittedAdapter}.`);
  }
  await import(`${pathToFileURL(emittedAdapter).href}?run=${Date.now()}`);
} finally {
  fs.rmSync(smokeConfig, { force: true });
  fs.rmSync(smokeDirectory, { recursive: true, force: true });
}

console.log(
  `Operations Vercel ESM import guard passed across ${visited.size} reachable TypeScript modules with executable emitted workspace runtime graph.`,
);
