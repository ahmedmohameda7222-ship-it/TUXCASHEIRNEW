import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMonorepoArchitecture } from './monorepo-architecture-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await assertMonorepoArchitecture(root);
console.log('Monorepo architecture guard passed.');
