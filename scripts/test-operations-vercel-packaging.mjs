import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const configPath = path.join(ROOT, 'apps', 'operations', 'vercel.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const includeFiles = config.functions?.['api/**/*.ts']?.includeFiles;
const patterns = Array.isArray(includeFiles) ? includeFiles : includeFiles ? [includeFiles] : [];

const required = ['../../packages/domain/src/**', '../../packages/application/src/**'];
const missing = required.filter((pattern) => !patterns.includes(pattern));

if (missing.length > 0) {
  throw new Error(
    `Operations Vercel Functions must explicitly package workspace runtime sources. Missing includeFiles: ${missing.join(', ')}`,
  );
}

console.log(
  `Operations Vercel workspace packaging contract passed with ${patterns.length} includeFiles pattern(s).`,
);
