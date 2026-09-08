import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set(['.git', '.tmp', 'node_modules', 'dist', 'coverage', 'release']);
const sourceExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const legacyBrowserMutationAllowlist = new Set(['apps/menu/src/pages/Admin.tsx']);
const catalogTablePattern = /\.from\(\s*['"](?:products|product_sections|menu_categories|modifiers|product_modifiers|combo_beverage_options)['"]\s*\)/;
const orderAuthorityTablePattern = /\.from\(\s*['"](?:orders|online_order_requests)['"]\s*\)/;
const mutationPattern = /\.(?:insert|update|upsert|delete)\s*\(/;

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function walk(root) {
  const files = [];
  async function visit(directory) {
    if (!(await exists(directory))) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

function relative(root, filename) {
  return path.relative(root, filename).split(path.sep).join('/');
}

export async function collectCatalogArchitectureViolations(root) {
  const files = await walk(root);
  const violations = [];

  const contractRoot = path.join(root, 'packages/catalog-contracts');
  if (!(await exists(path.join(contractRoot, 'package.json')))) {
    violations.push('@tux/catalog-contracts package is missing');
  } else {
    const pkg = JSON.parse(await readFile(path.join(contractRoot, 'package.json'), 'utf8'));
    if (pkg.name !== '@tux/catalog-contracts')
      violations.push('catalog contract package name must be @tux/catalog-contracts');
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
      violations.push('@tux/catalog-contracts must remain dependency-free transport code');
    }
  }

  for (const filename of files.filter((candidate) => sourceExtension.test(candidate))) {
    const rel = relative(root, filename);
    const source = await readFile(filename, 'utf8');

    if (rel.startsWith('packages/catalog-contracts/')) {
      if (
        /apps\/(?:operations|operations-desktop)|@tux\/operations|@supabase\/supabase-js|\.from\(/.test(
          source,
        )
      ) {
        violations.push(
          `catalog transport contract imports/uses application or persistence implementation: ${rel}`,
        );
      }
      if (/\b(?:shop_id|price_minor|image_key|sort_order|created_at|updated_at)\b/.test(source)) {
        violations.push(`catalog transport contract leaks persistence-row naming: ${rel}`);
      }
    }

    if (
      (rel.startsWith('apps/menu/') || rel.startsWith('apps/admin/')) &&
      /apps\/(?:operations|operations-desktop)|@tux\/operations/.test(source)
    ) {
      violations.push(`Menu/Admin imports Operations implementation: ${rel}`);
    }

    if (
      (rel.startsWith('apps/') || rel.startsWith('supabase/functions/catalog-public/')) &&
      source.includes('SUPABASE_SERVICE_ROLE_KEY')
    ) {
      violations.push(
        `privileged service-role secret referenced outside trusted catalog-admin/server boundary: ${rel}`,
      );
    }

    if (
      (rel.startsWith('apps/menu/') || rel.startsWith('apps/admin/')) &&
      !legacyBrowserMutationAllowlist.has(rel) &&
      catalogTablePattern.test(source) &&
      mutationPattern.test(source)
    ) {
      violations.push(`new direct browser catalog mutation outside grandfathered legacy Admin: ${rel}`);
    }

    if (
      rel.startsWith('apps/menu/') &&
      orderAuthorityTablePattern.test(source) &&
      mutationPattern.test(source)
    ) {
      violations.push(`direct browser order-authority mutation from Menu: ${rel}`);
    }
  }

  for (const filename of files) {
    const rel = relative(root, filename);
    if (/supabase\/migrations\//.test(rel) && !rel.startsWith('supabase/migrations/')) {
      violations.push(`second executable Supabase migration authority: ${rel}`);
    }
    if (path.basename(filename) === 'supabase_setup.sql') {
      violations.push(`legacy executable catalog SQL returned: ${rel}`);
    }
  }

  const legacyReference = path.join(root, 'apps/menu/legacy/supabase_setup.sql.reference');
  if (await exists(legacyReference)) {
    const rel = relative(root, legacyReference);
    if (!rel.endsWith('.reference')) violations.push('legacy catalog SQL must remain reference-only');
  }

  const publicFunction = path.join(root, 'supabase/functions/catalog-public/index.ts');
  if (await exists(publicFunction)) {
    const source = await readFile(publicFunction, 'utf8');
    if (source.includes('SUPABASE_SERVICE_ROLE_KEY'))
      violations.push('catalog-public must never use service-role credentials');
  }

  const adminFunction = path.join(root, 'supabase/functions/catalog-admin/index.ts');
  if (await exists(adminFunction)) {
    const source = await readFile(adminFunction, 'utf8');
    if (!source.includes('SUPABASE_SERVICE_ROLE_KEY'))
      violations.push(
        'catalog-admin trusted adapter must own its server-only privileged credential explicitly',
      );
  }

  return [...new Set(violations)].sort();
}

export async function assertCatalogArchitecture(root) {
  const violations = await collectCatalogArchitectureViolations(root);
  if (violations.length > 0) {
    throw new Error(`Catalog architecture violations:\n${violations.join('\n')}`);
  }
}
