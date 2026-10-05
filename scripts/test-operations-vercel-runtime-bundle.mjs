import fs from 'node:fs';

// The Vercel project setting exposes outside-root workspace files to the build,
// while includeFiles makes the raw TypeScript runtime graph part of Function bundles.
const config = JSON.parse(fs.readFileSync('apps/operations/vercel.json', 'utf8'));
const functionConfig = config.functions?.['api/**/*.ts'];
const expectedIncludeFiles = '../../packages/{domain,application}/src/**';

if (functionConfig?.includeFiles !== expectedIncludeFiles) {
  throw new Error(
    `Operations Vercel Functions must package the external workspace runtime graph with includeFiles=${expectedIncludeFiles}. Got ${JSON.stringify(functionConfig?.includeFiles ?? null)}.`,
  );
}

console.log('Operations Vercel workspace runtime bundle contract passed.');
