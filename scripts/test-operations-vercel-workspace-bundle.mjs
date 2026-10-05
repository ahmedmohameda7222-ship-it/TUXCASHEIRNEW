import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps', 'operations', 'vercel.json'), 'utf8'),
);

const whatsappConfig = config.functions?.['api/whatsapp*.ts'];
if (!whatsappConfig) {
  throw new Error('Operations Vercel config must package workspace sources for api/whatsapp*.ts.');
}

const includeFiles = Array.isArray(whatsappConfig.includeFiles)
  ? whatsappConfig.includeFiles
  : [whatsappConfig.includeFiles].filter(Boolean);

const requiredIncludes = [
  '../../packages/domain/package.json',
  '../../packages/domain/src/**',
  '../../packages/application/package.json',
  '../../packages/application/src/whatsapp*.ts',
];
for (const required of requiredIncludes) {
  if (!includeFiles.includes(required)) {
    throw new Error(`Missing WhatsApp Vercel includeFiles entry: ${required}`);
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tux-vercel-workspace-bundle-'));
try {
  const copyFile = (relativePath) => {
    const source = path.join(ROOT, relativePath);
    const destination = path.join(tempRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  };

  const copyTree = (sourceDir, destinationDir) => {
    fs.mkdirSync(destinationDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const destination = path.join(destinationDir, entry.name);
      if (entry.isDirectory()) copyTree(source, destination);
      else if (entry.isFile()) fs.copyFileSync(source, destination);
    }
  };

  copyFile('packages/domain/package.json');
  copyTree(
    path.join(ROOT, 'packages', 'domain', 'src'),
    path.join(tempRoot, 'packages', 'domain', 'src'),
  );
  copyFile('packages/application/package.json');
  for (const entry of fs.readdirSync(path.join(ROOT, 'packages', 'application', 'src'))) {
    if (/^whatsapp.*\.ts$/.test(entry)) {
      copyFile(path.join('packages', 'application', 'src', entry));
    }
  }

  const runtimeSource = fs.readFileSync(path.join(ROOT, 'server', 'workspaceRuntime.ts'), 'utf8');
  const runtimePath = path.join(tempRoot, 'server', 'workspaceRuntime.mjs');
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, runtimeSource);

  await import(`${pathToFileURL(runtimePath).href}?run=${Date.now()}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Operations WhatsApp Vercel workspace bundle contract passed.');
