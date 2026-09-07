import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionRoots = [
  'apps/operations/src/app',
  'apps/operations-desktop/src/main',
  'apps/operations-desktop/src/preload',
];
const forbiddenRuntimeTokens = [
  'TUX_WHATSAPP_ACCESS_TOKEN',
  'TUX_WHATSAPP_APP_SECRET',
  'TUX_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'graph.facebook.com',
  'web.whatsapp.com',
  'wa.me/',
];
const forbiddenClientMediaTokens = [
  'providerMediaId',
  'provider_media_id',
  'providerDownloadUrl',
  'provider_download_url',
  '/storage/v1/object/public',
  'getPublicUrl(',
];
const requestBoundaryFiles = [
  'apps/operations/src/app/browserWhatsAppRemote.ts',
  'apps/operations-desktop/src/main/desktopWhatsAppRemote.ts',
];
const forbiddenRequestBodyKeys = [
  'shopId',
  'deviceId',
  'sentByWorkerId',
  'providerPhoneNumberId',
  'to',
];

function isProductionSource(path) {
  const extension = extname(path);
  if (extension !== '.ts' && extension !== '.tsx' && extension !== '.mjs') return false;
  return !/(?:^|\/)[^/]*\.(?:test|spec)\.[^/]+$/.test(path.replaceAll('\\', '/'));
}

async function listProductionSources(root) {
  const absoluteRoot = resolve(repoRoot, root);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        const repoPath = relative(repoRoot, absolute).replaceAll('\\', '/');
        if (isProductionSource(repoPath)) files.push(repoPath);
      }
    }
  }
  await visit(absoluteRoot);
  return files;
}

async function source(path) {
  return readFile(resolve(repoRoot, path), 'utf8');
}

function fail(message) {
  console.error(`WhatsApp security gate failed: ${message}`);
  process.exitCode = 1;
}

const productionSources = (
  await Promise.all(productionRoots.map((root) => listProductionSources(root)))
).flat();

for (const path of productionSources) {
  const text = await source(path);
  for (const token of forbiddenRuntimeTokens) {
    if (text.includes(token)) fail(`${path} contains forbidden runtime token ${token}.`);
  }
  for (const token of forbiddenClientMediaTokens) {
    if (text.includes(token)) fail(`${path} exposes server-only WhatsApp media detail ${token}.`);
  }
}

for (const path of requestBoundaryFiles) {
  const text = await source(path);
  for (const key of forbiddenRequestBodyKeys) {
    const fieldPattern = new RegExp(`(?:^|[,{\\n]\\s*)${key}\\s*:`, 'm');
    if (fieldPattern.test(text)) {
      fail(`${path} can place trusted authority field ${key} in a client request body.`);
    }
  }
  if (!text.includes('/api/whatsapp')) {
    fail(`${path} does not route WhatsApp authority through /api/whatsapp.`);
  }
  if (!text.includes("action: 'CREATE_MEDIA_UPLOAD'") || !text.includes("action: 'FINALIZE_MEDIA_SEND'")) {
    fail(`${path} does not keep sendMedia behind the server-authorized media flow.`);
  }
}

const desktopRemote = await source('apps/operations-desktop/src/main/desktopWhatsAppRemote.ts');
if (!desktopRemote.includes("'x-tux-device-id': deviceId")) {
  fail('Desktop WhatsApp device authority is not carried by the authentication header.');
}

const electronSecurity = await source('apps/operations-desktop/src/main/security.ts');
for (const expected of [
  'contextIsolation: true',
  'nodeIntegration: false',
  'sandbox: true',
  'webSecurity: true',
  'webviewTag: false',
]) {
  if (!electronSecurity.includes(expected)) {
    fail(`createSecureWebPreferences no longer enforces ${expected}.`);
  }
}

if (process.exitCode === undefined) {
  console.log(`WhatsApp security gate passed (${productionSources.length} production source files scanned).`);
}
