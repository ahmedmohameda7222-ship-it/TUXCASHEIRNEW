import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// TypeScript's bundler resolver allows extensionless source imports, but native
// Node ESM never does. Normalize the compiled graph, not application logic.
const root = path.resolve('packages/domain/dist');
let checked = 0;
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(name);
    } else if (entry.isFile() && name.endsWith('.js')) {
      const original = await readFile(name, 'utf8');
      const result = original.replace(
        /((?:from\s*|import\s*\(\s*|import\s*)['"])(\.{1,2}\/[^'"]+)(['"])/g,
        (full, prefix, specifier, suffix) =>
          /\.(?:js|mjs|cjs|json)$/.test(specifier)
            ? full
            : `${prefix}${specifier}.js${suffix}`,
      );
      if (result !== original) await writeFile(name, result, 'utf8');
      assert.doesNotMatch(
        result,
        /(?:from\s*|import\s*\(\s*|import\s*)['"]\.{1,2}\/[^'"]+(?<!\.js|\.mjs|\.cjs|\.json)['"]/,
        'Unresolved relative native ESM import in ' + name,
      );
      checked++;
    }
  }
}
await walk(root);
assert.ok(checked > 0, 'Domain compile must emit JavaScript modules');
console.log(`Checked ${checked} compiled domain ESM modules.`);
