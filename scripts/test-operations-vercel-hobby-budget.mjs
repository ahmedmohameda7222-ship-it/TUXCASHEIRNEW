import fs from 'node:fs';
import path from 'node:path';

const OPERATIONS_API_DIR = 'apps/operations/api';
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

console.log(
  `Operations Vercel Hobby function budget passed: ${operationsApiFiles.length}/${HOBBY_SERVERLESS_FUNCTION_LIMIT}.`,
);
