import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = 'scripts/catalog-migration/catalog-relations-manifest.json';
const migrationPath = 'supabase/migrations/20260910003000_catalog_product_relationships.sql';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sql = readFileSync(migrationPath, 'utf8');
const normalizedSql = sql.replace(/\s+/g, ' ').toLowerCase();

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.shopId, 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46');
assert.equal(manifest.extraCategoryId, 'c55b48e4-4dec-5cfc-a179-ab93a911542b');
assert.equal(manifest.modifierMaxQuantity, 1);
assert.equal(manifest.modifiers.length, 13);
assert.equal(manifest.eligibleProductIds.length, 36);
assert.equal(manifest.comboProductIds.length, 5);
assert.equal(manifest.beverageProductIds.length, 2);

assert.ok(sql.includes(manifest.shopId), 'migration must hard-fence the canonical shop');
assert.ok(sql.includes(manifest.extraCategoryId), 'migration must hard-fence the Extras category');
for (const row of manifest.modifiers) {
  assert.ok(sql.includes(row.standaloneProductId), `migration must bind Extra UUID ${row.standaloneProductId}`);
  assert.ok(sql.includes(`'${row.name.replaceAll("'", "''")}'`), `migration must fence Extra name ${row.name}`);
  assert.ok(sql.includes(String(row.priceMinor)), `migration must fence Extra price ${row.priceMinor}`);
}
for (const id of manifest.eligibleProductIds) {
  assert.ok(sql.includes(id), `migration must fence eligible product UUID ${id}`);
}
for (const id of manifest.comboProductIds) {
  assert.ok(sql.includes(id), `migration must fence combo UUID ${id}`);
}
for (const id of manifest.beverageProductIds) {
  assert.ok(sql.includes(id), `migration must fence beverage UUID ${id}`);
}

const relationLock = /lock table public\.menu_categories\s*,\s*public\.products\s*,\s*public\.modifiers\s*,\s*public\.product_modifiers\s*,\s*public\.combo_beverage_options in share row exclusive mode\s*;/.exec(normalizedSql);
assert.ok(relationLock, 'migration must block concurrent catalog and relationship writes');
const canonicalShopNoop = /if not exists \(\s*select 1\s*from public\.shops\s*where id = v_shop_id\s*\) then/.exec(
  normalizedSql,
);
assert.ok(
  canonicalShopNoop,
  'clean-database no-op must be gated by absence of the canonical shop row, not missing catalog rows',
);
const firstInventoryRead = normalizedSql.indexOf('select count(*) into v_product_count');
assert.ok(firstInventoryRead >= 0, 'migration must contain the product inventory precondition');
assert.ok(relationLock.index < firstInventoryRead, 'relationship write lock must precede the first inventory read');
assert.ok(
  canonicalShopNoop.index < firstInventoryRead,
  'canonical-shop existence check must precede catalog inventory validation',
);

assert.match(sql, /v_product_count[^;]*<>\s*49/is, 'migration must fence exactly 49 products');
assert.match(sql, /v_extra_count[^;]*<>\s*13/is, 'migration must fence exactly 13 Extras');
assert.match(sql, /v_eligible_count[^;]*<>\s*36/is, 'migration must fence exactly 36 non-Extra products');
assert.match(sql, /v_combo_count[^;]*<>\s*5/is, 'migration must fence exactly 5 combos');
assert.match(sql, /v_beverage_count[^;]*<>\s*2/is, 'migration must fence exactly 2 beverages');
assert.match(sql, /v_modifier_count[^;]*<>\s*0/is, 'migration must require an empty modifier prestate');
assert.match(sql, /v_product_modifier_count[^;]*<>\s*0/is, 'migration must require an empty product-modifier prestate');
assert.match(sql, /v_combo_option_count[^;]*<>\s*0/is, 'migration must require an empty combo-option prestate');

const uuidOsspInstall = /create extension if not exists "uuid-ossp" with schema extensions\s*;/.exec(normalizedSql);
assert.ok(uuidOsspInstall, 'migration must install uuid-ossp before using uuid_generate_v5');
const firstUuidV5 = normalizedSql.indexOf('uuid_generate_v5');
assert.ok(firstUuidV5 >= 0, 'migration must generate deterministic modifier UUIDs');
assert.ok(uuidOsspInstall.index < firstUuidV5, 'uuid-ossp installation must precede uuid_generate_v5 usage');
assert.match(
  sql,
  /uuid_generate_v5\s*\([^,]+,\s*'standalone-modifier:'\s*\|\|/is,
  'modifier UUIDs must be generated deterministically from shop + standalone product identity',
);
assert.match(sql, /max_quantity[^;]*1/is, 'product-modifier links must cap each Extra at one selection');
assert.match(sql, /insert\s+into\s+public\.modifiers/is, 'migration must insert canonical modifiers');
assert.match(sql, /insert\s+into\s+public\.product_modifiers/is, 'migration must insert product-modifier links');
assert.match(sql, /insert\s+into\s+public\.combo_beverage_options/is, 'migration must insert combo beverage options');

assert.doesNotMatch(sql, /update\s+public\.(?:products|menu_categories)\b/i, 'migration must not mutate product or category business rows');
assert.doesNotMatch(sql, /delete\s+from\s+public\./i, 'migration must not delete canonical rows');
assert.match(sql, /post[- ](?:insert|migration)[^;]*verification|verification failed/is, 'migration must post-verify exact relationship authority');
assert.match(sql, /13[^;]*468[^;]*10|468[^;]*13[^;]*10/is, 'migration must post-verify 13 modifiers, 468 links, and 10 combo options');

console.log('catalog product relationships migration contract: ok');
