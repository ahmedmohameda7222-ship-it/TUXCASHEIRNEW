import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = 'scripts/catalog-migration/public-catalog-identity-manifest.json';
const migrationPath = 'supabase/migrations/20260909213000_catalog_public_identity_reconciliation.sql';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sql = readFileSync(migrationPath, 'utf8');

assert.equal(manifest.version, 1);
assert.equal(manifest.shopId, 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46');
assert.equal(manifest.categories.length, 7);
assert.equal(manifest.products.length, 49);

for (const row of manifest.categories) {
  assert.ok(sql.includes(row.id), `migration must bind category UUID ${row.id}`);
  assert.ok(sql.includes(`'${row.slug}'`), `migration must bind category slug ${row.slug}`);
}

for (const row of manifest.products) {
  assert.ok(sql.includes(row.id), `migration must bind product UUID ${row.id}`);
  assert.ok(sql.includes(`'${row.slug}'`), `migration must bind product slug ${row.slug}`);
}

assert.match(
  sql,
  /c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46/i,
  'migration must hard-fence the canonical shop',
);
assert.match(
  sql,
  /category_count[^;]*7|count\(\*\)[^;]*<>\s*7/is,
  'migration must fence exactly 7 categories',
);
assert.match(
  sql,
  /product_count[^;]*49|count\(\*\)[^;]*<>\s*49/is,
  'migration must fence exactly 49 products',
);
assert.match(
  sql,
  /conflicting[^;]*slug|slug[^;]*conflict/is,
  'migration must reject conflicting pre-existing slugs',
);
assert.match(
  sql,
  /inventory[^;]*(?:mismatch|drift)|uuid[^;]*(?:set|inventory)[^;]*(?:mismatch|drift)/is,
  'migration must fail closed on inventory drift',
);
assert.match(
  sql,
  /post-update|post update|verification failed/is,
  'migration must verify the final bindings',
);

const updateStatements = [
  ...sql.matchAll(/update\s+public\.(menu_categories|products)[\s\S]*?;/gi),
].map((match) => match[0]);
assert.equal(updateStatements.length, 2, 'migration must contain exactly two catalog UPDATE statements');
for (const statement of updateStatements) {
  const setClause = statement.match(/\bset\b([\s\S]*?)\bfrom\b/i)?.[1] ?? '';
  assert.match(setClause, /\bslug\s*=/i, 'catalog UPDATE must assign slug');
  assert.doesNotMatch(
    setClause,
    /\b(?:name|description|price_minor|category_id|sort_order|active|sold_out|family|is_combo|best_seller|image_key)\s*=/i,
    'migration must not mutate protected business fields',
  );
}

console.log('catalog public identity migration contract: ok');
