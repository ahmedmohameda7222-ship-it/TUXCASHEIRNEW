import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Missing-master Catalog Copy PostgreSQL skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing to reset a non-loopback PostgreSQL database');
}
function sql(query, label = 'SQL') {
  const result = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(label + ': ' + (result.stderr || result.stdout));
  return result.stdout.trim();
}
function file(name) {
  const result = spawnSync(
    'psql',
    [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(name + ': ' + (result.stderr || result.stdout));
}
function rpc(command, label) {
  return JSON.parse(sql('select (' + command + ')::text', label));
}
function quote(value) {
  return "'" + value.replaceAll("'", "''") + "'::jsonb";
}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $roles$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $roles$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $auth$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $auth$;`, 'isolated database reset');
const migration = '20261015080000_admin_catalog_copy_stage_created_entities.sql';
const files = readdirSync(resolve('supabase/migrations')).filter((name) =>
  /^\d+_.+\.sql$/.test(name),
).sort();
const idx = files.indexOf(migration);
if (idx < 0) throw new Error('Missing category/product staging migration source');
for (const name of files.slice(0, idx + 1)) file(name);

const B = '10000000-0000-4000-8000-000000000011';
const FOREIGN_B = '10000000-0000-4000-8000-000000000012';
const S = '20000000-0000-4000-8000-000000000011';
const T = '20000000-0000-4000-8000-000000000012';
const FOREIGN_S = '20000000-0000-4000-8000-000000000013';
const OWNER = '30000000-0000-4000-8000-000000000011';
const FOREIGN_OWNER = '30000000-0000-4000-8000-000000000012';
const MC = '40000000-0000-4000-8000-000000000011';
const MP = '50000000-0000-4000-8000-000000000011';
const SC = '60000000-0000-4000-8000-000000000011';
const SP = '70000000-0000-4000-8000-000000000011';
sql(`
insert into public.businesses(id,name) values ('${B}','Owner Business'),('${FOREIGN_B}','Other Business');
insert into public.shops(id,name,active,lifecycle_state) values
 ('${S}','Published source',true,'ACTIVE'),('${T}','Blank target',true,'ACTIVE'),
 ('${FOREIGN_S}','Foreign',true,'ACTIVE');
insert into public.business_shops(business_id,shop_id) values
 ('${B}','${S}'),('${B}','${T}'),('${FOREIGN_B}','${FOREIGN_S}');
insert into public.business_employees(id,business_id,display_name,role,active) values
 ('${OWNER}','${B}','Owner','OWNER',true),
 ('${FOREIGN_OWNER}','${FOREIGN_B}','Foreign Owner','OWNER',true);
insert into public.menu_categories(id,shop_id,slug,name,sort_order,active)
values ('${SC}','${S}','specials','Specials',3,true);
insert into public.products(
 id,shop_id,category_id,slug,name,price_minor,active,sold_out,is_combo,sort_order
) values ('${SP}','${S}','${SC}','coffee','Coffee',12000,true,false,false,4);
insert into public.catalog_master_categories(id,business_id,canonical_name)
values ('${MC}','${B}','Specials');
insert into public.catalog_category_shop_bindings(
 business_id,master_category_id,shop_id,canonical_category_id
) values ('${B}','${MC}','${S}','${SC}');
insert into public.catalog_master_products(id,business_id,master_category_id,canonical_name)
values ('${MP}','${B}','${MC}','Coffee');
insert into public.catalog_product_shop_overrides(
 business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out
) values ('${B}','${MP}','${S}','${SP}',12000,true,false);
`, 'two-business source-only master fixture');

const sourceBundle = sql(
  `select private.build_admin_catalog_bundle_v1('${S}'::uuid,1,now())::text`,
  'source bundle',
);
const targetBundle = sql(
  `select private.build_admin_catalog_bundle_v1('${T}'::uuid,1,now())::text`,
  'blank target bundle',
);
sql(`
insert into public.catalog_publish_versions(
 business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json
) values ('${B}','${S}',1,1,'BASELINE',${quote(sourceBundle)}),
 ('${B}','${T}',1,1,'BASELINE',${quote(targetBundle)});
insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
values ('${S}',1,${quote(sourceBundle)}),('${T}',1,${quote(targetBundle)});
`, 'published source and empty target baselines');

const draft = rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,1,'Import missing entities')`,
  'target draft',
);
if (!draft.ok || !draft.draftId) throw new Error('Cannot create target draft');
const args = `'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
 '${draft.draftId}'::uuid,1::bigint,1::bigint,1::bigint`;
const preview = rpc(
  `public.preview_admin_catalog_missing_entities_v1(${args})`,
  'trusted missing-entity preview',
);
const category = preview.categories?.[0];
const product = preview.products?.[0];
if (
  !preview.ok ||
  category?.status !== 'CREATE_REQUIRED' ||
  product?.status !== 'MISSING_TARGET_CATEGORY' ||
  product?.proposedTargetCategoryId !== category?.proposedTargetCategoryId ||
  !/^[0-9a-f]{64}$/.test(preview.creationFingerprint || '')
) throw new Error('Invalid source-master creation preview: ' + JSON.stringify(preview));

const stage = (commandId = 'create-cat-prod-1', fingerprint = preview.creationFingerprint) =>
  `public.stage_admin_catalog_copy_created_entities_v1(
    ${args},array['${SC}'::uuid],array['${SP}'::uuid],
    '${fingerprint}','${commandId}')`;
const staged = rpc(stage(), 'stage missing category and product');
if (!staged.ok || staged.draftRevision !== 2 || staged.createdCategories !== 1 ||
    staged.createdProducts !== 1 || staged.publishRequired !== true) {
  throw new Error('Missing Catalog entities not coherently staged: ' + JSON.stringify(staged));
}
const localCategoryId = staged.createdCategoryIds?.[0];
const localProductId = staged.createdProductIds?.[0];
if (localCategoryId !== category.proposedTargetCategoryId ||
    localProductId !== product.proposedTargetProductId ||
    localCategoryId === SC || localProductId === SP) {
  throw new Error('New local IDs differ from reviewable source-master plan');
}
const savedDraft = JSON.parse(sql(
  `select working_bundle_json::text from public.catalog_drafts where id='${draft.draftId}'`,
));
if (savedDraft.snapshot.categories[0]?.id !== localCategoryId ||
    savedDraft.snapshot.products[0]?.id !== localProductId ||
    savedDraft.snapshot.products[0]?.categoryId !== localCategoryId) {
  throw new Error('Target draft has orphaned or source-shop identities');
}
if (sql(`select (select count(*) from public.menu_categories where shop_id='${T}')::text||
  ','||(select count(*) from public.products where shop_id='${T}')::text`) !== '0,0') {
  throw new Error('Stage mutated target live Catalog before publish');
}
const replay = rpc(stage(), 'exact command replay');
if (!replay.ok || replay.replayed !== true || replay.draftRevision !== 2) {
  throw new Error('Creation command was not replay-safe');
}
const changedCommand = rpc(stage('create-cat-prod-1', '0'.repeat(64)), 'command collision');
if (changedCommand.ok !== false || changedCommand.code !== 'command_id_conflict') {
  throw new Error('Changed fingerprint reused creation command ID');
}
const stale = rpc(stage('second-stale-create'), 'stale target Draft creation');
if (stale.ok !== false || stale.code !== 'stale_draft_revision') {
  throw new Error('Second creation command bypassed target draft revision');
}
if (sql(`select count(*) from private.admin_catalog_copy_creation_intents
 where target_draft_id='${draft.draftId}'`) !== '2') {
  throw new Error('Category and Product intent mapping not durable before publish');
}
let foreignDenied = false;
try {
  rpc(stage('foreign-create').replace(`'${OWNER}'::uuid`, `'${FOREIGN_OWNER}'::uuid`),
    'cross-business Catalog entity creation');
} catch (error) {
  foreignDenied = /FORBIDDEN|BUSINESS_MISMATCH/.test(String(error));
}
if (!foreignDenied) throw new Error('Foreign tenant could stage another business Catalog');

const published = rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${draft.draftId}'::uuid,2,1)`,
  'publish missing Category/Product through canonical Catalog authority',
);
if (!published.ok || published.publishVersion !== 2) {
  throw new Error('Canonical publish refused missing entities: ' + JSON.stringify(published));
}
const identity = sql(`
select c.id::text||','||p.id::text||','||p.category_id::text||','||
 cb.master_category_id::text||','||pb.master_product_id::text
from public.menu_categories c
join public.products p on p.shop_id=c.shop_id and p.category_id=c.id
join public.catalog_category_shop_bindings cb
  on cb.shop_id=c.shop_id and cb.canonical_category_id=c.id
join public.catalog_product_shop_overrides pb
  on pb.shop_id=p.shop_id and pb.canonical_product_id=p.id
where c.shop_id='${T}'`, 'published target local/master identity');
if (identity !== [localCategoryId,localProductId,localCategoryId,MC,MP].join(',')) {
  throw new Error('Target publication duplicated or rewrote shared master identity: '+identity);
}
const publishedSnapshot = JSON.parse(sql(`
 select bundle_json::text from public.operations_configuration_snapshots
 where shop_id='${T}' and version=2`, 'Operations target publication'));
if (publishedSnapshot.snapshot.categories[0]?.id !== localCategoryId ||
    publishedSnapshot.snapshot.products[0]?.id !== localProductId) {
  throw new Error('Operations published configuration omitted staged Catalog entities');
}
const original = sql(`select count(*)::text||','||sum(price_minor)::text
 from public.products where shop_id='${S}'`, 'source untouched');
if (original !== '1,12000') throw new Error('Source live Product mutated during copy');
if (sql(`select count(*) from public.recipe_lines where shop_id='${T}'`) !== '0') {
  throw new Error('Catalog Copy copied unrelated recipe/stock history');
}
for (const role of ['anon','authenticated']) {
  const permitted = sql(`select has_function_privilege(
    '${role}',
    'public.stage_admin_catalog_copy_created_entities_v1(uuid,uuid,uuid,uuid,bigint,bigint,bigint,uuid[],uuid[],text,text)',
    'EXECUTE')`);
  if (permitted !== 'f') throw new Error('Unsafe entity Stage EXECUTE grant '+role);
}
console.log('Missing Catalog Category/Product Stage/Publish master identity integration passed.');
