import { spawn, spawnSync } from 'node:child_process';
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
const migration = '20261015044000_admin_catalog_copy_stage_created_entities.sql';
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

// This is the same public SQL projection consumed by the deployed Menu
// catalog-public Edge Function, not a synthetic React/API mock.
const publicMenuBefore = rpc(
  `public.read_catalog_public_v1('${T}'::uuid)`,
  'target Menu projection before Catalog Copy',
);
if (publicMenuBefore.shop?.id !== T ||
    publicMenuBefore.categories.length !== 0 ||
    publicMenuBefore.products.length !== 0) {
  throw new Error('Unpublished Category/Product leaked to target Menu');
}
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

// Archived master identities must never become newly linked target masters,
// even when their immutable source publication still contains old source IDs.
sql(`update public.catalog_master_categories set archived_at=now()
 where id='${MC}'`, 'archive source Category master in isolated fixture');
const archivedCategoryPreview = rpc(
  `public.preview_admin_catalog_missing_entities_v1(${args})`,
  'archived source Category master refused by Preview',
);
if (archivedCategoryPreview.categories?.[0]?.status !== 'MISSING_SOURCE_MASTER' ||
    archivedCategoryPreview.categories?.[0]?.proposedTargetCategoryId != null) {
  throw new Error('Archived source Category master offered a new target identity');
}
sql(`update public.catalog_master_categories set archived_at=null
 where id='${MC}'`, 'restore Category master fixture');
sql(`update public.catalog_master_products set archived_at=now()
 where id='${MP}'`, 'archive source Product master in isolated fixture');
const archivedProductPreview = rpc(
  `public.preview_admin_catalog_missing_entities_v1(${args})`,
  'archived source Product master refused by Preview',
);
if (archivedProductPreview.products?.[0]?.status !== 'MISSING_SOURCE_MASTER' ||
    archivedProductPreview.products?.[0]?.proposedTargetProductId != null) {
  throw new Error('Archived source Product master offered a new target identity');
}
sql(`update public.catalog_master_products set archived_at=null
 where id='${MP}'`, 'restore Product master fixture');

const stage = (commandId = 'create-cat-prod-1', fingerprint = preview.creationFingerprint) =>
  `public.stage_admin_catalog_copy_created_entities_v1(
    ${args},array['${SC}'::uuid],array['${SP}'::uuid],
    '${fingerprint}','${commandId}')`;
// Two source Categories may be distinct under existing case-sensitive
// uniqueness but still collide after normalization. Never silently stage both.
const SC2 = '60000000-0000-4000-8000-000000000012';
const MC2 = '40000000-0000-4000-8000-000000000012';
sql(`insert into public.menu_categories(id,shop_id,name,sort_order,active)
 values ('${SC2}','${S}','specials',5,true);
 insert into public.catalog_master_categories(id,business_id,canonical_name)
 values ('${MC2}','${B}','specials');
 insert into public.catalog_category_shop_bindings(
 business_id,master_category_id,shop_id,canonical_category_id)
 values ('${B}','${MC2}','${S}','${SC2}')`, 'casefold source category fixture');
const duplicateNamesBundle = sql(
  `select private.build_admin_catalog_bundle_v1('${S}'::uuid,1,now())::text`,
  'duplicate source names under independent master IDs',
);
sql(`update public.catalog_publish_versions set bundle_json=${quote(duplicateNamesBundle)}
 where shop_id='${S}' and publish_version=1;
 update public.operations_configuration_snapshots set bundle_json=${quote(duplicateNamesBundle)}
 where shop_id='${S}' and version=1;`, 'isolated casefold source snapshot');
const ambiguousPreview = rpc(
  `public.preview_admin_catalog_missing_entities_v1(${args})`,
  'trusted ambiguous source category preview');
if(!ambiguousPreview.ok || ambiguousPreview.categories.length!==2) {
  throw new Error('Ambiguous source master identity fixture was not accepted');
}
const ambiguous = rpc(
  `public.stage_admin_catalog_copy_created_entities_v1(
    ${args},array['${SC}'::uuid,'${SC2}'::uuid],array['${SP}'::uuid],
    '${ambiguousPreview.creationFingerprint}','casefold-conflict-1')`,
  'reject casefold-colliding source entities');
if(ambiguous.ok!==false || ambiguous.code!=='catalog_copy_target_name_conflict') {
  throw new Error('Two casefold-colliding masters were staged: '+JSON.stringify(ambiguous));
}
sql(`update public.catalog_publish_versions set bundle_json=${quote(sourceBundle)}
 where shop_id='${S}' and publish_version=1;
 update public.operations_configuration_snapshots set bundle_json=${quote(sourceBundle)}
 where shop_id='${S}' and version=1;`, 'restore isolated published source fixture');

// Force an immutable audit write to fail after the canonical Draft CAS and
// private intent inserts. The entire command must roll back transactionally.
sql(`create function public.reject_test_catalog_creation_audit() returns trigger
language plpgsql as $forced$ begin
 if new.action_type='CATALOG_COPY_STAGED' then
   raise exception 'TUX_CREATION_AUDIT_FORCED_ROLLBACK';
 end if;
 return new;
end; $forced$;
create trigger reject_test_catalog_creation_audit
 before insert on public.admin_audit_events for each row
 execute function public.reject_test_catalog_creation_audit();`, 'isolated audit rollback injection');
let auditRollback = false;
try {
  rpc(stage('creation-rollback'), 'failure after staged Draft write');
} catch (error) {
  auditRollback = String(error).includes('TUX_CREATION_AUDIT_FORCED_ROLLBACK');
}
sql(`drop trigger reject_test_catalog_creation_audit on public.admin_audit_events;
drop function public.reject_test_catalog_creation_audit();`, 'remove isolated audit trigger');
if (!auditRollback) throw new Error('Audit failure did not abort Catalog entity Stage');
if (sql(`select draft_revision from public.catalog_drafts where id='${draft.draftId}'`) !== '1' ||
    sql(`select count(*) from private.admin_catalog_copy_creation_intents
          where target_draft_id='${draft.draftId}'`) !== '0' ||
    sql(`select count(*) from public.admin_catalog_copy_receipts
          where command_id='creation-rollback'`) !== '0') {
  throw new Error('Failed Stage left partial Draft change, mapping intent or receipt');
}
// Issue two identical commands through independent PostgreSQL sessions.
// Both requests carry the same immutable actor/payload identity: exactly one
// may mutate the Draft and the other must receive its durable replay receipt.
function concurrentStage(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'psql',
      [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', 'select (' + command + ')::text'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Concurrent Stage failed: ' + error));
        return;
      }
      try {
        resolve(JSON.parse(output.trim()));
      } catch (cause) {
        reject(new Error('Invalid concurrent Stage response: ' + String(cause)));
      }
    });
  });
}
const concurrentResults = await Promise.all([
  concurrentStage(stage()),
  concurrentStage(stage()),
]);
const originalStages = concurrentResults.filter((result) =>
  result.ok === true && result.replayed === false,
);
const replayStages = concurrentResults.filter((result) =>
  result.ok === true && result.replayed === true,
);
if (originalStages.length !== 1 || replayStages.length !== 1 ||
    originalStages[0].draftRevision !== replayStages[0].draftRevision) {
  throw new Error('Two simultaneous commands generated duplicate or missing Stage effects: ' +
    JSON.stringify(concurrentResults));
}
const staged = originalStages[0];
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

// Archive a business master AFTER Stage and BEFORE Publish. The trusted
// binder must revalidate current source-master eligibility inside the same
// transaction, leaving zero partial live target rows on failure.
sql(`update public.catalog_master_products set archived_at=now()
 where id='${MP}'`, 'archive Product master after Stage');
let archivedMasterRejected = false;
try {
  rpc(`public.publish_catalog_draft_v1(
    '${OWNER}'::uuid,'${draft.draftId}'::uuid,2,1)`,
    'stale archived master at target Publish');
} catch (error) {
  archivedMasterRejected = String(error).includes('TUX_CATALOG_COPY_PRODUCT_INTENT_INCOMPLETE');
}
if (!archivedMasterRejected) throw new Error('Archived master published as a live target binding');
if (sql(`select count(*) from public.products where shop_id='${T}'`) !== '0' ||
    sql(`select count(*) from public.catalog_product_shop_overrides
      where shop_id='${T}'`) !== '0') {
  throw new Error('Archived master Publish left partial target Catalog data');
}
sql(`update public.catalog_master_products set archived_at=null
 where id='${MP}'`, 'restore Product master for normal publish');

// A source publication changed between Stage and Publish must fail closed.
// This creates/removes test-only versions in this loopback PostgreSQL fixture.
sql(`insert into public.catalog_publish_versions(
 business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json)
 values ('${B}','${S}',2,2,'BASELINE',${quote(sourceBundle)});
insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
 values ('${S}',2,${quote(sourceBundle)})`, 'isolated newer source publication');
let stalePublishRejected=false;
try {
  rpc(`public.publish_catalog_draft_v1(
    '${OWNER}'::uuid,'${draft.draftId}'::uuid,2,1)`,
    'stale source publication at target Publish');
} catch(error) {
  stalePublishRejected=String(error).includes('TUX_CATALOG_COPY_SOURCE_PUBLICATION_STALE');
}
if(!stalePublishRejected) throw new Error('Target publisher ignored newer source version');
if(sql(`select count(*) from public.products where shop_id='${T}'`)!=='0' ||
   sql(`select count(*) from public.catalog_product_shop_overrides
       where shop_id='${T}'`)!=='0' ||
   sql(`select status||','||draft_revision::text from public.catalog_drafts
        where id='${draft.draftId}'`)!=='DRAFT,2') {
  throw new Error('Stale source publish partially changed target Catalog');
}
// Restore ONLY the isolated version fixture to exercise successful publication.
sql(`delete from public.catalog_publish_versions
 where shop_id='${S}' and publish_version=2;
delete from public.operations_configuration_snapshots
 where shop_id='${S}' and version=2;`, 'restore isolated source version fixture');
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
const targetPublicMenu = rpc(
  `public.read_catalog_public_v1('${T}'::uuid)`,
  'published Menu consumer target projection',
);
if (
  targetPublicMenu.shop?.id !== T ||
  targetPublicMenu.categories.length !== 1 ||
  targetPublicMenu.categories[0]?.id !== localCategoryId ||
  targetPublicMenu.products.length !== 1 ||
  targetPublicMenu.products[0]?.id !== localProductId ||
  targetPublicMenu.products[0]?.category_id !== localCategoryId ||
  targetPublicMenu.products[0]?.price_minor !== 12000 ||
  Object.hasOwn(targetPublicMenu.products[0], 'masterProductId')
) {
  throw new Error('Target published Menu projection did not use local bound identities');
}
const sourcePublicMenu = rpc(
  `public.read_catalog_public_v1('${S}'::uuid)`,
  'source Menu projection after target publication',
);
if (sourcePublicMenu.shop?.id !== S ||
    sourcePublicMenu.categories[0]?.id !== SC ||
    sourcePublicMenu.products[0]?.id !== SP) {
  throw new Error('Target publication rewrote or leaked source Menu identities');
}
if (sql(`select has_function_privilege(
  'anon','public.read_catalog_public_v1(uuid)','EXECUTE')::text`)
  !== 'true') {
  throw new Error('Published Menu reader no longer accessible by public role');
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
