import { readFile, writeFile } from 'node:fs/promises';

const path = 'packages/persistence/src/browser/indexedDbMigrations.test.ts';
let text = await readFile(path, 'utf8');
text = text.replace(
  'expect(indexedDbMigrationVersions()).toEqual([1, 2, 3, 4]);',
  'expect(indexedDbMigrationVersions()).toEqual([1, 2, 3, 4, 5]);',
);
text = text.replace('expect(INDEXED_DB_VERSION).toBe(4);', 'expect(INDEXED_DB_VERSION).toBe(5);');
text = text.replace(
  ").toThrow('IndexedDB migration v5 is missing');",
  ").toThrow('IndexedDB migration v6 is missing');",
);
await writeFile(path, text);
