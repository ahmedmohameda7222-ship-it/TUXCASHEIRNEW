import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const staticPaths =
  /^(?:\.github\/workflows\/|api\/|server\/|apps\/|packages\/|e2e\/|scripts\/ci-fast-|(?:playwright|package|tsconfig)[^/]*\.)/;
const unitPaths =
  /^(?:api|server|apps|packages|supabase\/functions|scripts|e2e)\/.*\.(?:[cm]?[jt]sx?)$/;
const typesPaths =
  /^(?:api|server|apps|packages|e2e)\/.*\.[cm]?[jt]sx?$|^tsconfig.*\.json$|^package(?:-lock)?\.json$/;
const operationsPaths =
  /^apps\/operations(?:-desktop)?\/|^api\/operations|^packages\/(?:sync|persistence|application|printing)\//;

export function classifyFiles(paths) {
  const has = (pattern) => paths.some((path) => pattern.test(path));
  return {
    static: has(staticPaths),
    unit: has(unitPaths),
    types: has(typesPaths),
    shared: has(/^packages\/|^tsconfig.*\.json$|^package(?:-lock)?\.json$/),
    admin: has(/^apps\/admin\/|^api\/admin|^server\/|^packages\/admin-contracts\//),
    operations: has(operationsPaths),
    desktop: has(/^apps\/operations-desktop\//),
    menu: has(/^apps\/menu\/|^packages\/(?:catalog-contracts|order-intake-contracts)\//),
    api: has(/^api\/|^server\/|^apps\/operations\/api\//),
    e2e: has(/^e2e\/.*\.[cm]?[jt]sx?$|^playwright.*\.ts$/),
    migration: has(/^supabase\/migrations\/|^supabase\/config\.toml$|^scripts\/test-migration/),
    edge: has(/^supabase\/functions\/|^supabase\/config\.toml$/),
    security: has(/auth|session|bootstrap|device|permission|pin|security|whatsapp/i),
    whatsapp: has(/whatsapp/i),
  };
}

function changedPaths() {
  const head = process.env.TUX_HEAD_SHA || 'HEAD';
  let base = process.env.TUX_BASE_SHA || '';
  if (!base || /^0+$/.test(base)) {
    base = execFileSync('git', ['rev-parse', head + '^'], {
      encoding: 'utf8',
    }).trim();
  }
  const output = execFileSync('git', ['diff', '--name-only', '-z', base, head]);
  return output.toString('utf8').split('\0').filter(Boolean);
}

if (process.argv[1] && /(?:^|\/)ci-fast-scope\.mjs$/.test(process.argv[1])) {
  const paths = changedPaths();
  const scope = classifyFiles(paths);
  const lines = Object.entries(scope).map(([name, active]) => name + '=' + String(active));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }
  console.log('Changed files (' + paths.length + '):\n' + paths.join('\n'));
  console.log('Fast CI scope:\n' + lines.join('\n'));
}
