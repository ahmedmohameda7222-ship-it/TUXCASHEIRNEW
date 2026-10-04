import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OPERATIONS_API_DIR = path.join(ROOT, 'apps', 'operations', 'api');

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

function moduleSpecifiers(source) {
  const specifiers = [];
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'\"]*?\sfrom\s*)?['\"]([^'\"]+)['\"]/g;
  const dynamicPattern = /import\(\s*['\"]([^'\"]+)['\"]\s*\)/g;

  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function repositoryPath(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function resolveRelativeSource(importer, specifier) {
  const resolved = path.resolve(path.dirname(importer), specifier);
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

  return undefined;
}

const queue = collectTsFiles(OPERATIONS_API_DIR);
const visited = new Set();
const violations = [];

while (queue.length > 0) {
  const file = queue.shift();
  if (!file || visited.has(file)) continue;
  visited.add(file);

  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of moduleSpecifiers(source)) {
    if (!specifier.startsWith('.')) continue;

    const resolvedSource = resolveRelativeSource(file, specifier);
    if (resolvedSource === undefined) {
      violations.push(`${repositoryPath(file)} -> ${specifier}`);
      continue;
    }
    if (resolvedSource !== null && !visited.has(resolvedSource)) queue.push(resolvedSource);
  }
}

if (violations.length > 0) {
  throw new Error(
    `Operations Vercel serverless graph contains Node ESM-unsafe relative imports. Use explicit .js specifiers:\n${violations
      .sort()
      .map((violation) => `- ${violation}`)
      .join('\n')}`,
  );
}

console.log(
  `Operations Vercel ESM import guard passed across ${visited.size} reachable TypeScript modules.`,
);
