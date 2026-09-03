import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const persistenceRoot = path.join(root, 'packages', 'persistence', 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

const violations = [];
for (const filename of await sourceFiles(persistenceRoot)) {
  const source = await readFile(filename, 'utf8');
  if (/from\s+['"]@tux\/application(?:['"\/])/.test(source)) {
    violations.push(path.relative(root, filename));
  }
}

assert.deepEqual(
  violations,
  [],
  `Persistence must not import @tux/application. Violations: ${violations.join(', ')}`,
);

console.log('WhatsApp package-layering guard passed.');
