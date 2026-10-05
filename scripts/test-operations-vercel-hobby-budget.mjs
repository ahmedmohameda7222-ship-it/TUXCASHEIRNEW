import fs from 'node:fs';
import path from 'node:path';

const OPERATIONS_API_DIR = 'apps/operations/api';
const OPERATIONS_VERCEL_CONFIG = 'apps/operations/vercel.json';
const WORKSPACE_RUNTIME_PATH = 'server/workspaceRuntime.ts';
const HOBBY_SERVERLESS_FUNCTION_LIMIT = 12;

function collectTsFiles(directory, baseDirectory = directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTsFiles(absolutePath, baseDirectory);
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        return [];
      }
      return [path.relative(baseDirectory, absolutePath).split(path.sep).join('/')];
    })
    .sort();
}

const operationsApiFiles = collectTsFiles(OPERATIONS_API_DIR);

if (operationsApiFiles.length > HOBBY_SERVERLESS_FUNCTION_LIMIT) {
  throw new Error(
    `Operations Vercel deployment exceeds the Hobby Serverless Function limit: ${operationsApiFiles.length} > ${HOBBY_SERVERLESS_FUNCTION_LIMIT}. Functions: ${operationsApiFiles.join(', ')}`,
  );
}

const vercelConfig = JSON.parse(fs.readFileSync(OPERATIONS_VERCEL_CONFIG, 'utf8'));
const workspaceRuntimeSource = fs.readFileSync(WORKSPACE_RUNTIME_PATH, 'utf8');
const workspacePackages = [
  ...new Set(
    [...workspaceRuntimeSource.matchAll(/from ['"]\.\.\/packages\/([^/]+)\/src\//g)].map(
      (match) => match[1],
    ),
  ),
].sort();
const expectedIncludeFiles = `{${workspacePackages
  .map((packageName) => `../../packages/${packageName}/src/**`)
  .join(',')}}`;
const apiFunctionConfig = vercelConfig.functions?.['api/**/*.ts'];

if (apiFunctionConfig?.includeFiles !== expectedIncludeFiles) {
  throw new Error(
    `Operations Vercel functions must package native workspace runtime sources. Expected functions["api/**/*.ts"].includeFiles = ${JSON.stringify(expectedIncludeFiles)}, received ${JSON.stringify(apiFunctionConfig?.includeFiles ?? null)}.`,
  );
}

console.log(
  `Operations Vercel Hobby function budget passed: ${operationsApiFiles.length}/${HOBBY_SERVERLESS_FUNCTION_LIMIT}; workspace runtime packaging covers ${workspacePackages.join(', ')}.`,
);
