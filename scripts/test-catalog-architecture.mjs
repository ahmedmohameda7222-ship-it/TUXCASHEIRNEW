import path from 'node:path';
import { assertCatalogArchitecture } from './catalog-architecture-guard.mjs';

await assertCatalogArchitecture(path.resolve('.'));
console.log('Catalog architecture guards passed.');
