/* global Buffer, console, process */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const artifactRoot = join(root, 'artifacts', 'tux-final');
const viewports = [
  [1440, 900],
  [1280, 800],
  [768, 1024],
  [390, 844],
  [375, 844],
  [320, 720],
];
const matrixScenes = [
  'alerts-list',
  'alerts-filters',
  'alerts-empty',
  'alerts-source-error',
  'alerts-restricted',
  'health-overview',
  'health-unknown',
  'health-stale',
  'devices-list',
  'device-detail',
  'device-revoked',
  'printers-unavailable',
  'checklist-open',
  'checklist-close',
  'manager-log',
  'whatsapp-overview',
  'whatsapp-not-configured',
  'whatsapp-conversation',
  'whatsapp-quick-replies',
  'whatsapp-rule-disabled',
];
const parityScenes = [
  'alerts-list',
  'alerts-empty',
  'devices-list',
  'health-stale',
  'whatsapp-overview',
  'whatsapp-not-configured',
  'whatsapp-conversation',
  'whatsapp-rule-disabled',
];

function posix(path) {
  return path.split(sep).join('/');
}

function expectedFiles() {
  const expected = new Map();
  for (const scene of matrixScenes) {
    for (const [width, height] of viewports) {
      const path = `matrix/${scene}__${width}x${height}__light__cold.png`;
      expected.set(path, { matrix: 'matrix', scene, width, height, theme: 'light', entry: 'cold' });
    }
  }
  for (const scene of parityScenes) {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      for (const theme of ['light', 'dark']) {
        for (const entry of ['cold', 'warm']) {
          const path = `parity/${scene}__${width}x${height}__${theme}__${entry}.png`;
          expected.set(path, { matrix: 'parity', scene, width, height, theme, entry });
        }
      }
    }
  }
  return expected;
}

function walkPngs(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return walkPngs(path);
    return item.isFile() && item.name.toLowerCase().endsWith('.png') ? [path] : [];
  });
}

function inspectPng(path) {
  const bytes = readFileSync(path);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`Invalid PNG signature: ${posix(relative(root, path))}`);
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Missing PNG IHDR: ${posix(relative(root, path))}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const expected = expectedFiles();
const actualPaths = walkPngs(artifactRoot);
const actual = new Map(actualPaths.map((path) => [posix(relative(artifactRoot, path)), path]));
const missing = [...expected.keys()].filter((path) => !actual.has(path)).sort();
const extra = [...actual.keys()].filter((path) => !expected.has(path)).sort();
const generatedAt = new Date().toISOString();
const entries = [...expected.entries()]
  .filter(([path]) => actual.has(path))
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([path, metadata]) => {
    const inspected = inspectPng(actual.get(path));
    if (inspected.width !== metadata.width) {
      throw new Error(`${path}: expected width ${metadata.width}, got ${inspected.width}`);
    }
    if (inspected.height < metadata.height) {
      throw new Error(
        `${path}: expected full-page height >= ${metadata.height}, got ${inspected.height}`,
      );
    }
    return {
      path,
      ...metadata,
      actualWidth: inspected.width,
      actualHeight: inspected.height,
      sha256: inspected.sha256,
      timestamp: generatedAt,
      mockDeclaration:
        'Synthetic Admin auth/API data; fake provider and device transport; no production endpoints.',
    };
  });

mkdirSync(artifactRoot, { recursive: true });
const playwrightVersion = require('@playwright/test/package.json').version;
const browser = await chromium.launch({ headless: true });
const chromiumVersion = browser.version();
await browser.close();
const exactHeadSha = git('rev-parse', 'HEAD');
const commitSource =
  process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  git('branch', '--show-current') ||
  'detached';
const manifest = {
  exactHeadSha,
  commitSource,
  playwrightVersion,
  chromiumVersion,
  generatedAt,
  mockDeclaration:
    'Synthetic Admin auth/API data; fake provider and device transport; no production endpoints, real device actions, or live WhatsApp sends.',
  expectedCount: expected.size,
  actualCount: actual.size,
  missing,
  extra,
  entries,
};
writeFileSync(
  join(artifactRoot, 'SCREENSHOT_MANIFEST.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
writeFileSync(
  join(artifactRoot, 'SHA256SUMS.txt'),
  `${entries.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n')}\n`,
);

if (missing.length > 0 || extra.length > 0 || entries.length !== expected.size) {
  throw new Error(
    `Screenshot inventory mismatch: expected=${expected.size} actual=${actual.size} missing=${missing.length} extra=${extra.length}`,
  );
}
console.log(
  `Admin final screenshot integrity passed: ${entries.length}/${expected.size} PNGs at ${exactHeadSha}.`,
);
