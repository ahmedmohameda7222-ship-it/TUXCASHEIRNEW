import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const configPath = path.join(ROOT, 'apps', 'operations', 'vercel.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const includeFiles = config.functions?.['api/**/*.ts']?.includeFiles;
const required = '../../packages/{domain,application}/src/**';

if (includeFiles !== required) {
  throw new Error(
    `Operations Vercel Functions must explicitly package workspace runtime sources with includeFiles=${required}; received ${JSON.stringify(includeFiles)}.`,
  );
}

console.log(`Operations Vercel workspace packaging contract passed: ${includeFiles}.`);
