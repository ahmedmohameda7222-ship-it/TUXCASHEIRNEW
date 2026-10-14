import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Catalog Copy isolated PostgreSQL skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost','127.0.0.1','::1'].includes(new URL(db).hostname))
  throw new Error('Catalog Copy test refuses non-loopback PostgreSQL');
function sql(query,label='SQL') {
  const r=spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1','-At','-c',query],{encoding:'utf8'});
  if(r.status!==0)throw new Error(label+': '+(r.stderr||r.stdout));
  return r.stdout.trim();
}
function file(name){
  const r=spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1','-f',resolve('supabase/migrations',name)],{encoding:'utf8'});
  if(r.status!==0)throw new Error(name+': '+(r.stderr||r.stdout));
}
function rpc(s,label){return JSON.parse(sql('select ('+s+')::text',label));}
function assertDenied(x,code){if(x.ok!==false||x.code!==code)throw new Error(code+': '+JSON.stringify(x));}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade;create schema private;
drop schema if exists auth cascade;create schema auth;
drop schema if exists storage cascade;create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $do$ begin
if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $do$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $do$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $do$;`,'reset');
const migration='20261014160306_admin_inventory_master_casefold_unique.sql';
const files=readdirSync(resolve('supabase/migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort();
const index=files.indexOf(migration);if(index<0)throw new Error('Catalog Copy migration missing');
for(const name of files.slice(0,index+1))file(name);
const B='10000000-0000-4000-8000-000000000001';
const B2='10000000-0000-4000-8000-000000000002';
const S='20000000-0000-4000-8000-000000000001';
const T='20000000-0000-4000-8000-000000000002';
const FOREIGN='20000000-0000-4000-8000-000000000003';
const OWNER='30000000-0000-4000-8000-000000000001';
const OTHER='30000000-0000-4000-8000-000000000002';
const MC='40000000-0000-4000-8000-000000000001';
const MP='50000000-0000-4000-8000-000000000001';
const C1='60000000-0000-4000-8000-000000000001';
const C2='60000000-0000-4000-8000-000000000002';
const P1='70000000-0000-4000-8000-000000000001';
const P2='70000000-0000-4000-8000-000000000002';
sql(`
insert into public.businesses(id,name) values ('${B}','Tenant 1'),('${B2}','Tenant 2');
insert into public.shops(id,name,active,lifecycle_state) values
('${S}','Source',true,'ACTIVE'),('${T}','Target',true,'ACTIVE'),
('${FOREIGN}','Foreign',true,'ACTIVE');
insert into public.business_shops(business_id,shop_id) values
('${B}','${S}'),('${B}','${T}'),('${B2}','${FOREIGN}');
insert into public.business_employees(id,business_id,display_name,role,active) values
('${OWNER}','${B}','Owner','OWNER',true),
('${OTHER}','${B2}','Other owner','OWNER',true);
insert into public.menu_categories(id,shop_id,slug,name,sort_order,active) values
('${C1}','${S}','burgers','Burgers',0,true),
('${C2}','${T}','burgers','Burgers',20,true);
insert into public.products(id,shop_id,category_id,slug,name,price_minor,active,sold_out,is_combo,sort_order)
values ('${P1}','${S}','${C1}','burger','Burger',12000,true,true,false,5),
('${P2}','${T}','${C2}','burger','Burger',22000,true,false,false,40);
insert into public.catalog_master_categories(id,business_id,canonical_name)
values ('${MC}','${B}','Burgers');
insert into public.catalog_category_shop_bindings(business_id,master_category_id,shop_id,canonical_category_id)
values ('${B}','${MC}','${S}','${C1}'),('${B}','${MC}','${T}','${C2}');
insert into public.catalog_master_products(id,business_id,master_category_id,canonical_name)
values ('${MP}','${B}','${MC}','Burger');
insert into public.catalog_product_shop_overrides(
business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out
) values
('${B}','${MP}','${S}','${P1}',12000,true,true),
('${B}','${MP}','${T}','${P2}',22000,true,false);
`,'two-shop master fixture');
const sourceBundle=sql(`select private.build_admin_catalog_bundle_v1('${S}'::uuid,1,now())::text`,'source bundle');
const targetBundle=sql(`select private.build_admin_catalog_bundle_v1('${T}'::uuid,1,now())::text`,'target bundle');
function quoteJson(j){return "'"+j.replaceAll("'","''")+"'::jsonb";}
sql(`insert into public.catalog_publish_versions(
business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json
) values
('${B}','${S}',1,1,'BASELINE',${quoteJson(sourceBundle)}),
('${B}','${T}',1,1,'BASELINE',${quoteJson(targetBundle)})`,'publish fixtures');
// Canonical publish increments from Operations configuration snapshots. This
// fixture must have the same initial version as the BASELINE catalog publish.
sql(`insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
values ('${S}',1,${quoteJson(sourceBundle)}),
       ('${T}',1,${quoteJson(targetBundle)})
on conflict (shop_id,version) do nothing`, 'seed baseline Operations projections');
const draft=rpc(`public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,1,'Copy target')`,'draft create');
if(!draft.ok || !draft.draftId)throw new Error('Could not create canonical draft: '+JSON.stringify(draft));
const params=(from=S,to=T,revision=1,sourceVersion=1,domains="array['productPrices','productAvailability']::text[]")=>
`'${OWNER}'::uuid,'${from}'::uuid,'${to}'::uuid,'${draft.draftId}'::uuid,
${sourceVersion}::bigint,1::bigint,${revision}::bigint,${domains}`;
const preview=rpc(`public.preview_admin_catalog_shop_copy_v1(${params()})`,'preview');
if(!preview.ok || preview.mappedProducts!==1 || preview.changedProducts!==1 ||
   !/^[0-9a-f]{64}$/.test(preview.fingerprint))
throw new Error('Expected one mapped changed product: '+JSON.stringify(preview));
// Exercise the trusted database boundary using a real scoped, non-owner employee.
// The source grants catalog.view, the target grants catalog.edit, but pricing is
// explicitly denied; publication/staging versions remain read-only during preview.
const EDITOR='30000000-0000-4000-8000-000000000003';
sql(`insert into public.business_employees(id,business_id,display_name,role,active)
values ('${EDITOR}','${B}','Catalog manager','MANAGER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
values ('${B}','${EDITOR}','${S}'),('${B}','${EDITOR}','${T}');
insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect)
values ('${B}','${EDITOR}','catalog.view','ALLOW'),
       ('${B}','${EDITOR}','catalog.edit','ALLOW'),
       ('${B}','${EDITOR}','catalog.pricing','DENY');`, 'scoped catalog manager');
const scopedArgs=(domains)=>params(S,T,1,1,domains).replace(
  `'${OWNER}'::uuid`,`'${EDITOR}'::uuid`
);
const scopedPreview=rpc(
  `public.preview_admin_catalog_shop_copy_v1(${scopedArgs("array['productOrder']::text[]")})`,
  'non-pricing manager product-order preview'
);
if(!scopedPreview.ok || scopedPreview.changedProducts!==1)
  throw new Error('Scoped non-pricing catalog preview was denied: '+JSON.stringify(scopedPreview));
let scopedPricingDenied=false;
try {
  rpc(`public.preview_admin_catalog_shop_copy_v1(${scopedArgs("array['productPrices']::text[]")})`,
    'non-pricing manager forbidden prices');
} catch(error) {
  scopedPricingDenied=/TUX_ADMIN_CATALOG_FORBIDDEN/.test(String(error));
}
if(!scopedPricingDenied)
  throw new Error('A non-pricing catalog manager could preview restricted product prices');
sql(`delete from public.employee_shop_assignments
where business_id='${B}' and employee_id='${EDITOR}' and shop_id='${T}'`,
  'revoke target-shop assignment');
let unassignedTargetDenied=false;
try {
  rpc(`public.preview_admin_catalog_shop_copy_v1(${scopedArgs("array['productOrder']::text[]")})`,
    'manager unassigned target');
} catch(error) {
  unassignedTargetDenied=/TUX_ADMIN_CATALOG_FORBIDDEN/.test(String(error));
}
if(!unassignedTargetDenied)
  throw new Error('Unassigned manager could preview the target shop catalog');
sql(`insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
values ('${B}','${EDITOR}','${T}')`, 'restore isolated manager shop scope');
let crossBusinessDenied = false;
try {
  const result = rpc(
    `public.preview_admin_catalog_shop_copy_v1(${params(FOREIGN,T)})`,
    'cross-tenant preview',
  );
  crossBusinessDenied = result.ok === false;
} catch (error) {
  crossBusinessDenied = /FORBIDDEN|BUSINESS_MISMATCH/.test(String(error));
}
if (!crossBusinessDenied) throw new Error('Cross-business Catalog Copy was not denied');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${params(S,T,1,2)})`,'stale source'),'stale_catalog_copy_preview');
const apply=(fingerprint=preview.fingerprint,command='catalog-copy-1',revision=1)=>
`public.apply_admin_catalog_shop_copy_v1(${params(S,T,revision)},'${fingerprint}', '${command}')`;
// Source/shop versions, missing master mappings and inactive shops must fail
// before any draft change or audit can be recorded.
assertDenied(
  rpc(`public.preview_admin_catalog_shop_copy_v1('${OWNER}'::uuid,'${S}'::uuid,
    '${T}'::uuid,'${draft.draftId}'::uuid,1,2,1,
    array['productAvailability']::text[])`,'stale target publish'),
  'stale_catalog_copy_preview',
);
sql(`delete from public.catalog_product_shop_overrides where shop_id='${T}' and master_product_id='${MP}'`,
  'remove target business-master mapping in isolated fixture');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${params()})`,'missing target mapping'),
  'catalog_copy_missing_target_dependencies');
sql(`insert into public.catalog_product_shop_overrides(
business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out
) values ('${B}','${MP}','${T}','${P2}',22000,true,false)`, 'restore mapping');
sql(`update public.shops set active=false,lifecycle_state='ARCHIVED' where id='${T}'`,
  'archive target in isolated fixture');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${params()})`,'archived target'),
  'catalog_copy_shop_inactive');
sql(`update public.shops set active=true,lifecycle_state='ACTIVE' where id='${T}'`,
  'reactivate isolated target fixture');
const applied=rpc(apply(),'stage copy');
if(!applied.ok||applied.draftRevision!==2||applied.publishRequired!==true)
throw new Error('Catalog copy staging failed: '+JSON.stringify(applied));
const replay=rpc(apply(),'replay copy');
if(!replay.ok||replay.replayed!==true||replay.draftRevision!==2)
throw new Error('Catalog Copy idempotency failed: '+JSON.stringify(replay));
// An immutable command receipt is scoped to the exact actor and canonical
// request. A reused command ID with altered domains or versions must conflict,
// even if the caller retains a previously valid preview fingerprint.
assertDenied(
  rpc(`public.apply_admin_catalog_shop_copy_v1(${params(S,T,1,1,"array['productAvailability']::text[]")},
    '${preview.fingerprint}','catalog-copy-1')`,'changed-domain command ID'),
  'command_id_conflict',
);
assertDenied(
  rpc(`public.apply_admin_catalog_shop_copy_v1(${params().replace(
    `'${OWNER}'::uuid`,`'${EDITOR}'::uuid`
  )},'${preview.fingerprint}','catalog-copy-1')`,'foreign-actor command ID'),
  'command_id_conflict',
);
assertDenied(
  rpc(`public.apply_admin_catalog_shop_copy_v1(${params(S,T,1,2)},
    '${preview.fingerprint}','catalog-copy-1')`,'changed-source-version command ID'),
  'command_id_conflict',
);
assertDenied(rpc(apply('0'.repeat(64)),'collision'),'command_id_conflict');
const state=sql(`select (working_bundle_json->'snapshot'->'products'->0->>'priceMinor') || ',' ||
(working_bundle_json->'snapshot'->'products'->0->>'soldOut')
from public.catalog_drafts where id='${draft.draftId}'`);
if(state!=='12000,true')throw new Error('Target draft prices or availability not mapped: '+state);
const sourceUntouched=sql(`select price_minor||','||sold_out from public.products where id='${P1}'`);
const targetUntouched=sql(`select price_minor||','||sold_out from public.products where id='${P2}'`);
if(sourceUntouched!=='12000,true'||targetUntouched!=='22000,false')
throw new Error('Catalog copy mutated live product rows before publication');
const receiptCount=sql(`select count(*) from public.admin_catalog_copy_receipts where command_id='catalog-copy-1'`);
if(receiptCount!=='1')throw new Error('Catalog Copy receipt not idempotent');
const receiptBinding=sql(`select request_fingerprint ~ '^[0-9a-f]{64}$'
from public.admin_catalog_copy_receipts where command_id='catalog-copy-1'`);
if(receiptBinding!=='t')
  throw new Error('Catalog Copy receipt lacks canonical request binding');
const auditCount=sql(`select count(*) from public.admin_audit_events where action_type='CATALOG_COPY_STAGED'`);
if(auditCount!=='1')throw new Error('Catalog copy audit not append-only or once-only');
// A second, different command must observe a stale draft revision rather than
// silently stage over the preceding copy.
assertDenied(
  rpc(`public.preview_admin_catalog_shop_copy_v1(${params(S,T,1)})`,
    'stale target draft CAS'),
  'stale_draft_revision',
);
// Force the last audit INSERT of a new command to fail after the draft write.
// The entire transaction (draft revision, change record and receipt) must roll
// back; no partial pending catalog configuration can survive the exception.
const revision2Preview = rpc(
  `public.preview_admin_catalog_shop_copy_v1(${params(S,T,2)})`,
  'second-command preview',
);
if(!revision2Preview.ok) throw new Error('Second-copy preview refused: '+JSON.stringify(revision2Preview));
sql(`create function public.catalog_copy_test_reject_audit() returns trigger
language plpgsql as $copyfail$ begin
  if new.action_type='CATALOG_COPY_STAGED' then
    raise exception 'CATALOG_COPY_FORCED_ROLLBACK_TEST';
  end if;
  return new;
end; $copyfail$;
create trigger catalog_copy_test_rollback before insert on public.admin_audit_events
for each row execute function public.catalog_copy_test_reject_audit();`, 'inject isolated audit failure');
let atomicRollbackObserved = false;
try {
  rpc(`public.apply_admin_catalog_shop_copy_v1(${params(S,T,2)},
    '${revision2Preview.fingerprint}','catalog-copy-rollback')`, 'atomicity failure injection');
} catch(error) {
  atomicRollbackObserved = String(error).includes('CATALOG_COPY_FORCED_ROLLBACK_TEST');
}
sql('drop trigger catalog_copy_test_rollback on public.admin_audit_events; drop function public.catalog_copy_test_reject_audit();',
  'remove isolated failure injection');
if(!atomicRollbackObserved) throw new Error('Injected audit failure did not abort Catalog Copy');
const unchangedRevision = sql(`select draft_revision from public.catalog_drafts where id='${draft.draftId}'`);
if(unchangedRevision!=='2') throw new Error('Partial target draft update survived failed catalog audit');
const noFailedReceipt = sql(`select count(*) from public.admin_catalog_copy_receipts
where command_id='catalog-copy-rollback'`);
if(noFailedReceipt!=='0') throw new Error('Failed Catalog Copy persisted a command receipt');
const auditsAfterFailure = sql(`select count(*) from public.admin_audit_events
where action_type='CATALOG_COPY_STAGED'`);
if(auditsAfterFailure!=='1') throw new Error('Failed copy changed immutable audit history');
for(const role of ['anon','authenticated'])for(const fn of [
 'public.preview_admin_catalog_shop_copy_v1(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[])',
 'public.apply_admin_catalog_shop_copy_v1(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[],text,text)',
 'private.build_admin_catalog_copy_existing_products_v1(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[])'
])if(sql(`select has_function_privilege('${role}','${fn}','EXECUTE')`)!=='f')
throw new Error('Unsafe catalog copy role grant '+role+' '+fn);
const published=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${draft.draftId}'::uuid,2,1)`,
  'publish staged draft through canonical authority',
);
if(!published.ok || published.publishVersion!==2)
  throw new Error('Canonical publication rejected staged Catalog Copy: '+JSON.stringify(published));
const targetLive=sql(`select price_minor||','||sold_out from public.products where id='${P2}'`);
if(targetLive!=='12000,true')
  throw new Error('Published Catalog Copy failed to project into Operations target catalog: '+targetLive);
const sourceAfterPublish=sql(`select price_minor||','||sold_out from public.products where id='${P1}'`);
if(sourceAfterPublish!=='12000,true')
  throw new Error('Target publication unexpectedly changed source shop catalog');
const recorded=sql(`select count(*) from public.catalog_publish_versions
where shop_id='${T}' and publish_version=2 and source_kind='DRAFT'`);
if(recorded!=='1') throw new Error('Catalog publication version not recorded');
// Category ordering uses distinct local category IDs connected only by a reviewed
// business-level master mapping. It must never copy source IDs or touch live
// categories before the explicit target draft publish.
const categoryDraft=rpc(`public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,2,'Copy mapped category ordering')`, 'category draft');
if(!categoryDraft.ok||!categoryDraft.draftId)throw new Error('Category draft failed: '+JSON.stringify(categoryDraft));
const categoryArgs=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,'${categoryDraft.draftId}'::uuid,
1::bigint,2::bigint,1::bigint,array['categoryOrder']::text[]`;
const categoryPreview=rpc(`public.preview_admin_catalog_shop_copy_v1(${categoryArgs})`,'category preview');
if(!categoryPreview.ok||categoryPreview.mappedCategories!==1||
  categoryPreview.changedCategories!==1||categoryPreview.changedProducts!==0||
  categoryPreview.categoryDifferences?.[0]?.targetCategoryId!==C2)
  throw new Error('Category copy did not retain target mapping: '+JSON.stringify(categoryPreview));
const categoryApply=rpc(`public.apply_admin_catalog_shop_copy_v1(${categoryArgs},
'${categoryPreview.fingerprint}','catalog-copy-category-1')`, 'stage categories');
if(!categoryApply.ok||categoryApply.draftRevision!==2||categoryApply.changedCategories!==1)
  throw new Error('Category draft staging failed: '+JSON.stringify(categoryApply));
const priorCategory=sql(`select sort_order from public.menu_categories where id='${C2}'`);
if(priorCategory!=='20')throw new Error('Category copy changed live target before publish');
const categoryPublished=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${categoryDraft.draftId}'::uuid,2,2)`,
  'publish copied category through canonical authority'
);
if(!categoryPublished.ok||categoryPublished.publishVersion!==3)
  throw new Error('Category publish rejected: '+JSON.stringify(categoryPublished));
const publishedOrder=sql(`select sort_order from public.menu_categories where id='${C2}'`);
const sourceOrder=sql(`select sort_order from public.menu_categories where id='${C1}'`);
if(publishedOrder!=='0'||sourceOrder!=='0')throw new Error('Category published ordering or source scope invalid');
const targetIdentity=sql(`select id from public.menu_categories where shop_id='${T}'`);
if(targetIdentity!==C2)throw new Error('Category copy duplicated or replaced target category ID');
// Product sorting is an explicit domain. A different canonical product ID in
// the same business must retain its identity and all unselected fields.
const orderDraft=rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,3,'Copy mapped product ordering')`,
  'product-order draft',
);
if(!orderDraft.ok||!orderDraft.draftId)
  throw new Error('Product-order draft failed: '+JSON.stringify(orderDraft));
const orderArgs=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,'${orderDraft.draftId}'::uuid,
1::bigint,3::bigint,1::bigint,array['productOrder']::text[]`;
const orderPreview=rpc(`public.preview_admin_catalog_shop_copy_v1(${orderArgs})`,'product-order preview');
if(!orderPreview.ok||orderPreview.mappedProducts!==1||
   orderPreview.changedProducts!==1||orderPreview.changedCategories!==0||
   orderPreview.differences?.[0]?.targetProductId!==P2||
   Number(orderPreview.differences?.[0]?.sortOrderBefore)!==40||
   Number(orderPreview.differences?.[0]?.sortOrderAfter)!==5)
  throw new Error('Product-order preview failed mapped ID and diff: '+JSON.stringify(orderPreview));
const stagedOrder=rpc(`public.apply_admin_catalog_shop_copy_v1(${orderArgs},
  '${orderPreview.fingerprint}','catalog-copy-product-order-1')`, 'stage mapped product ordering');
if(!stagedOrder.ok||stagedOrder.draftRevision!==2||stagedOrder.changedProducts!==1)
  throw new Error('Product-order staging failed: '+JSON.stringify(stagedOrder));
const stagedSort=sql(`select working_bundle_json->'snapshot'->'products'->0->>'sortOrder'
from public.catalog_drafts where id='${orderDraft.draftId}'`);
if(stagedSort!=='5')throw new Error('Target draft product sort order was not copied');
const beforeOrderPublish=sql(`select sort_order from public.products where id='${P2}'`);
if(beforeOrderPublish!=='40')throw new Error('Product ordering mutated live rows before publish');
const publishedProductOrder=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${orderDraft.draftId}'::uuid,2,3)`,
  'publish product ordering through canonical authority',
);
if(!publishedProductOrder.ok||publishedProductOrder.publishVersion!==4)
  throw new Error('Product-order publication failed: '+JSON.stringify(publishedProductOrder));
const afterOrder=sql(`select id||','||sort_order||','||price_minor from public.products where id='${P2}'`);
if(afterOrder!==P2+',5,12000')
  throw new Error('Product ordering replaced target identity or price: '+afterOrder);
const sourceSort=sql(`select sort_order from public.products where id='${P1}'`);
if(sourceSort!=='5')throw new Error('Product ordering mutated source shop');

// Product/category relationships use shop-local IDs. Reassignments must use
// master-category bindings, never a source shop's category UUID.
const C3='60000000-0000-4000-8000-000000000003';
const assignmentDraft=rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,4,'Category-assignment copy')`,
  'create category-assignment target draft',
);
if(!assignmentDraft.ok)throw new Error('Category assignment target draft failed');
const catDraftJson=JSON.parse(sql(`select working_bundle_json::text from public.catalog_drafts
where id='${assignmentDraft.draftId}'`));
const otherCategory={...catDraftJson.snapshot.categories[0],id:C3,shopId:T,
  name:'Target-only grouping',slug:'target-only',sortOrder:61,active:true};
catDraftJson.snapshot.categories.push(otherCategory);
catDraftJson.snapshot.products[0].categoryId=C3;
const preparedCategory=rpc(`public.apply_catalog_draft_change_v1(
  '${OWNER}'::uuid,'${assignmentDraft.draftId}'::uuid,1,
  jsonb_build_object('bundleJson',${quoteJson(JSON.stringify(catDraftJson))}))`,
  'prepare alternative target category via canonical draft');
if(!preparedCategory.ok || preparedCategory.draftRevision!==2)
  throw new Error('Could not prepare valid alternative target category: '+JSON.stringify(preparedCategory));
const assignmentArgs=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
  '${assignmentDraft.draftId}'::uuid,1::bigint,4::bigint,2::bigint,
  array['productCategoryAssignments']::text[]`;
sql(`delete from public.catalog_category_shop_bindings
where shop_id='${T}' and master_category_id='${MC}'`,
  'remove target category binding in isolated copy fixture');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${assignmentArgs})`,
  'missing master-mapped category assignment'),'catalog_copy_missing_target_dependencies');
sql(`insert into public.catalog_category_shop_bindings(
  business_id,master_category_id,shop_id,canonical_category_id)
values ('${B}','${MC}','${T}','${C2}')`,
  'restore target master-category binding');
const assignmentPreview=rpc(
  `public.preview_admin_catalog_shop_copy_v1(${assignmentArgs})`,
  'preview canonical shop-local category reassignment');
if(!assignmentPreview.ok || assignmentPreview.changedProducts!==1 ||
   assignmentPreview.differences?.[0]?.categoryIdBefore!==C3 ||
   assignmentPreview.differences?.[0]?.categoryIdAfter!==C2 ||
   assignmentPreview.differences?.[0]?.targetProductId!==P2)
  throw new Error('Category reassignment must map target-local IDs with preview diff: '+
    JSON.stringify(assignmentPreview));
const stagedCategory=rpc(`public.apply_admin_catalog_shop_copy_v1(
  ${assignmentArgs},'${assignmentPreview.fingerprint}','copy-category-assignment-1')`,
  'stage canonical category reassignment');
if(!stagedCategory.ok || stagedCategory.draftRevision!==3)
  throw new Error('Could not stage mapped target category assignment: '+JSON.stringify(stagedCategory));
const stagedCategoryId=sql(`select working_bundle_json->'snapshot'->'products'->0->>'categoryId'
from public.catalog_drafts where id='${assignmentDraft.draftId}'`);
if(stagedCategoryId!==C2 || stagedCategoryId===C1)
  throw new Error('Source category UUID leaked into target draft: '+stagedCategoryId);
const publishedCategory=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${assignmentDraft.draftId}'::uuid,3,4)`,
  'publish category reassignment through canonical authority');
if(!publishedCategory.ok || publishedCategory.publishVersion!==5)
  throw new Error('Mapped category assignment failed to publish: '+JSON.stringify(publishedCategory));
const liveCategoryId=sql(`select category_id from public.products where id='${P2}'`);
if(liveCategoryId!==C2)
  throw new Error('Published target product category did not preserve target identity: '+liveCategoryId);

// Copy a combo's beverage relationships only after resolving BOTH the combo
// and beverage IDs through source/target business-master product mappings.
const CMP='50000000-0000-4000-8000-000000000002';
const BMP='50000000-0000-4000-8000-000000000003';
const SCP='70000000-0000-4000-8000-000000000003';
const TCP='70000000-0000-4000-8000-000000000004';
const SBP='70000000-0000-4000-8000-000000000005';
const TBP='70000000-0000-4000-8000-000000000006';
const TCLOCAL='70000000-0000-4000-8000-000000000007';
sql(`
insert into public.products(id,shop_id,category_id,slug,name,price_minor,active,sold_out,is_combo,sort_order)
values ('${SCP}','${S}','${C1}','meal','Meal',26000,true,false,true,7),
       ('${TCP}','${T}','${C2}','meal','Meal',28000,true,false,true,10),
       ('${SBP}','${S}','${C1}','drink','Drink',5000,true,false,false,8),
       ('${TBP}','${T}','${C2}','drink','Drink',6000,true,false,false,11),
       ('${TCLOCAL}','${T}','${C2}','local-combo','Local combo',38000,true,false,true,12);
insert into public.catalog_master_products(id,business_id,master_category_id,canonical_name)
values ('${CMP}','${B}','${MC}','Meal'),('${BMP}','${B}','${MC}','Drink');
insert into public.catalog_product_shop_overrides(
business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out)
values ('${B}','${CMP}','${S}','${SCP}',26000,true,false),
       ('${B}','${CMP}','${T}','${TCP}',28000,true,false),
       ('${B}','${BMP}','${S}','${SBP}',5000,true,false),
       ('${B}','${BMP}','${T}','${TBP}',6000,true,false);
insert into public.combo_beverage_options(shop_id,combo_product_id,beverage_product_id,sort_order)
values ('${S}','${SCP}','${SBP}',11),
       ('${T}','${TCLOCAL}','${TBP}',91);
`, 'isolated cross-shop combo and beverage master fixtures');
const comboSourceBundle=sql(`select private.build_admin_catalog_bundle_v1('${S}'::uuid,2,now())::text`);
const comboTargetBundle=sql(`select private.build_admin_catalog_bundle_v1('${T}'::uuid,6,now())::text`);
sql(`insert into public.catalog_publish_versions(
business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json)
values ('${B}','${S}',2,2,'BASELINE',${quoteJson(comboSourceBundle)}),
       ('${B}','${T}',6,6,'BASELINE',${quoteJson(comboTargetBundle)});
insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
values ('${S}',2,${quoteJson(comboSourceBundle)}),
       ('${T}',6,${quoteJson(comboTargetBundle)})
on conflict (shop_id,version) do nothing;`, 'isolated source/target combo published baselines');
const comboCopyDraft=rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,6,'Master-mapped combo options')`,
  'create target combo draft');
if(!comboCopyDraft.ok||!comboCopyDraft.draftId)
  throw new Error('Cannot create combo target draft: '+JSON.stringify(comboCopyDraft));
const comboCopyArgs=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
'${comboCopyDraft.draftId}'::uuid,2::bigint,6::bigint,1::bigint,
array['comboBeverageOptions']::text[]`;
sql(`delete from public.catalog_product_shop_overrides
where master_product_id='${BMP}' and shop_id='${T}'`,
  'remove target beverage master binding');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${comboCopyArgs})`,
  'missing mapped target beverage'),'catalog_copy_missing_target_dependencies');
sql(`insert into public.catalog_product_shop_overrides(
business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out)
values ('${B}','${BMP}','${T}','${TBP}',6000,true,false)`,
  'restore target beverage business-master mapping');
const comboCopyPreview=rpc(
  `public.preview_admin_catalog_shop_copy_v1(${comboCopyArgs})`,
  'preview master-mapped combo beverage options');
if(!comboCopyPreview.ok||comboCopyPreview.mappedComboBeverageOptions!==1||
   comboCopyPreview.changedComboBeverageOptions!==1||
   comboCopyPreview.comboDifferences?.[0]?.targetComboProductId!==TCP||
   comboCopyPreview.comboDifferences?.[0]?.targetBeverageProductId!==TBP)
  throw new Error('Combo beverage copy preview was not target-local: '+
    JSON.stringify(comboCopyPreview));
const comboCopyStaged=rpc(
  `public.apply_admin_catalog_shop_copy_v1(${comboCopyArgs},
  '${comboCopyPreview.fingerprint}','combo-beverage-copy-1')`,
  'stage mapped beverage options');
if(!comboCopyStaged.ok||comboCopyStaged.draftRevision!==2)
  throw new Error('Combo beverage copy staging failed: '+JSON.stringify(comboCopyStaged));
const comboBeforeLive=sql(`select count(*) from public.combo_beverage_options
where shop_id='${T}' and combo_product_id='${TCP}'`);
if(comboBeforeLive!=='0')throw new Error('Combo copy mutated target live options before publish');
const comboDraftOption=sql(`select
(opt.value->>'comboProductId')||','||(opt.value->>'beverageProductId')
from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'comboBeverageOptions') opt(value)
where d.id='${comboCopyDraft.draftId}' and opt.value->>'comboProductId'='${TCP}'`);
if(comboDraftOption!==TCP+','+TBP)
  throw new Error('Source-local combo/beverage IDs leaked into target draft: '+comboDraftOption);
const comboLocalDraft=sql(`select count(*)
from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'comboBeverageOptions') opt(value)
where d.id='${comboCopyDraft.draftId}'
and opt.value->>'comboProductId'='${TCLOCAL}'
and opt.value->>'beverageProductId'='${TBP}'
and opt.value->>'sortOrder'='91'`);
if(comboLocalDraft!=='1')
  throw new Error('Copy removed target-only combo options from the draft');
const comboCopyPublished=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,'${comboCopyDraft.draftId}'::uuid,2,6)`,
  'publish target combo options');
if(!comboCopyPublished.ok||comboCopyPublished.publishVersion!==7)
  throw new Error('Target combo publish failed: '+JSON.stringify(comboCopyPublished));
const comboLive=sql(`select combo_product_id||','||beverage_product_id||','||sort_order
from public.combo_beverage_options where shop_id='${T}' and combo_product_id='${TCP}'`);
if(comboLive!==TCP+','+TBP+',11')
  throw new Error('Target combo beverage projection is not master-mapped: '+comboLive);
const comboLocalLive=sql(`select combo_product_id||','||beverage_product_id||','||sort_order
from public.combo_beverage_options
where shop_id='${T}' and combo_product_id='${TCLOCAL}'`);
if(comboLocalLive!==TCLOCAL+','+TBP+',91')
  throw new Error('Target-only combo options were lost on publication: '+comboLocalLive);
const comboSourceUnchanged=sql(`select combo_product_id||','||beverage_product_id
from public.combo_beverage_options where shop_id='${S}'`);
if(comboSourceUnchanged!==SCP+','+SBP)
  throw new Error('Combo beverage copy mutated source configuration');

// Product modifier links are shop-local: a canonical standalone product
// supplies an independently master-mapped identity for a modifier option.
// Both product and modifier IDs must be remapped; preserve target-only links.
const SMI='80000000-0000-4000-8000-000000000001';
const TMI='80000000-0000-4000-8000-000000000002';
sql(`insert into public.modifiers(id,shop_id,name,price_minor,standalone_product_id,active,sort_order)
values ('${SMI}','${S}','Source drink modifier',500,'${SBP}',true,3),
       ('${TMI}','${T}','Target drink modifier',600,'${TCLOCAL}',true,8);
insert into public.product_modifiers(shop_id,product_id,modifier_id,max_quantity,sort_order)
values ('${S}','${P1}','${SMI}',2,6),
       ('${T}','${TCLOCAL}','${TMI}',1,99);`,
  'source and target modifiers with distinct shop IDs and target-only link');
const linkedSourceBundle=sql(`select private.build_admin_catalog_bundle_v1('${S}'::uuid,3,now())::text`);
const linkedTargetBundle=sql(`select private.build_admin_catalog_bundle_v1('${T}'::uuid,8,now())::text`);
sql(`insert into public.catalog_publish_versions(
business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json)
values ('${B}','${S}',3,3,'BASELINE',${quoteJson(linkedSourceBundle)}),
       ('${B}','${T}',8,8,'BASELINE',${quoteJson(linkedTargetBundle)});
insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
values ('${S}',3,${quoteJson(linkedSourceBundle)}),
       ('${T}',8,${quoteJson(linkedTargetBundle)})
on conflict (shop_id,version) do nothing;`,
  'isolated modifier-link publication fixture');
const modifierLinkDraft=rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,8,'Mapped modifier links')`,
  'new target modifier-link draft');
if(!modifierLinkDraft.ok||!modifierLinkDraft.draftId)
  throw new Error('Cannot create canonical target modifier draft: '+JSON.stringify(modifierLinkDraft));
const modifierLinkArgs=(rev)=>`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
'${modifierLinkDraft.draftId}'::uuid,3::bigint,8::bigint,${rev}::bigint,
array['productModifierLinks']::text[]`;
assertDenied(
  rpc(`public.preview_admin_catalog_shop_copy_v1(${modifierLinkArgs(1)})`,
      'modifier standalone target identity not matched'),
  'catalog_copy_missing_target_dependencies',
);
const modifierTargetDraft=JSON.parse(sql(`select working_bundle_json::text from public.catalog_drafts
where id='${modifierLinkDraft.draftId}'`));
modifierTargetDraft.snapshot.modifiers.find(m=>m.id===TMI).standaloneProductId=TBP;
const modifierCorrected=rpc(`public.apply_catalog_draft_change_v1(
'${OWNER}'::uuid,'${modifierLinkDraft.draftId}'::uuid,1,
jsonb_build_object('bundleJson',${quoteJson(JSON.stringify(modifierTargetDraft))}))`,
  'canonical correction of target modifier standalone product');
if(!modifierCorrected.ok||modifierCorrected.draftRevision!==2)
  throw new Error('Could not resolve target modifier mapping in draft: '+JSON.stringify(modifierCorrected));
const modifierLinkPreview=rpc(
  `public.preview_admin_catalog_shop_copy_v1(${modifierLinkArgs(2)})`,
  'preview product modifier links via master standalone products');
if(!modifierLinkPreview.ok||modifierLinkPreview.changedProductModifierLinks!==1||
   modifierLinkPreview.mappedProductModifierLinks!==1||
   modifierLinkPreview.productModifierLinkDifferences?.[0]?.targetProductId!==P2||
   modifierLinkPreview.productModifierLinkDifferences?.[0]?.targetModifierId!==TMI)
  throw new Error('Modifier link preview did not map target-local IDs: '+
    JSON.stringify(modifierLinkPreview));
const modifierLinkApplied=rpc(`public.apply_admin_catalog_shop_copy_v1(
${modifierLinkArgs(2)},'${modifierLinkPreview.fingerprint}','product-modifier-links-1')`,
  'stage source modifier links into target draft');
if(!modifierLinkApplied.ok||modifierLinkApplied.draftRevision!==3||
   modifierLinkApplied.changedProductModifierLinks!==1)
  throw new Error('Modifier link draft apply failed: '+JSON.stringify(modifierLinkApplied));
const modifierLiveBefore=sql(`select count(*) from public.product_modifiers
where shop_id='${T}' and product_id='${P2}'`);
if(modifierLiveBefore!=='0')
  throw new Error('Modifier link copy wrote live target before canonical publication');
const modifierMappedDraft=sql(`select count(*) from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'productModifierLinks') entry(value)
where d.id='${modifierLinkDraft.draftId}'
and entry.value->>'productId'='${P2}'
and entry.value->>'modifierId'='${TMI}'
and entry.value->>'maxQuantity'='2'
and entry.value->>'sortOrder'='6'`);
if(modifierMappedDraft!=='1')throw new Error('Mapped modifier link absent from target draft');
const modifierLocalDraft=sql(`select count(*) from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'productModifierLinks') entry(value)
where d.id='${modifierLinkDraft.draftId}' and entry.value->>'productId'='${TCLOCAL}'
and entry.value->>'modifierId'='${TMI}'`);
if(modifierLocalDraft!=='1')throw new Error('Target-only modifier link was lost on draft apply');
const modifierLinksPublished=rpc(`public.publish_catalog_draft_v1(
'${OWNER}'::uuid,'${modifierLinkDraft.draftId}'::uuid,3,8)`,
  'publish master-mapped modifier link options');
if(!modifierLinksPublished.ok||modifierLinksPublished.publishVersion!==9)
  throw new Error('Canonical modifier publication failed: '+JSON.stringify(modifierLinksPublished));
const modifierLive=sql(`select product_id||','||modifier_id||','||max_quantity||','||sort_order
from public.product_modifiers where shop_id='${T}' and product_id='${P2}'`);
if(modifierLive!==P2+','+TMI+',2,6')
  throw new Error('Published modifier link reused source IDs or corrupted quantities: '+modifierLive);
const modifierLocalLive=sql(`select product_id||','||modifier_id
from public.product_modifiers where shop_id='${T}' and product_id='${TCLOCAL}'`);
if(modifierLocalLive!==TCLOCAL+','+TMI)
  throw new Error('Target-only product modifier link did not survive publication');
const modifierSourceLive=sql(`select product_id||','||modifier_id
from public.product_modifiers where shop_id='${S}' and product_id='${P1}'`);
if(modifierSourceLive!==P1+','+SMI)
  throw new Error('Source product modifiers mutated during cross-shop copy');

// Modifier definitions may be copied only when anchored to the same business
// master standalone product. Preserve the target modifier and product UUIDs,
// target-only modifiers, source configuration, and canonical publish boundary.
const TLOCAL_MOD='80000000-0000-4000-8000-000000000003';
sql(`insert into public.modifiers(id,shop_id,name,price_minor,standalone_product_id,active,sort_order)
values ('${TLOCAL_MOD}','${T}','Local-only modifier',700,'${TCLOCAL}',true,13)`,
  'target-only modifier definition fixture');
const modifierSourceBundle=sql(`select private.build_admin_catalog_bundle_v1('${S}'::uuid,4,now())::text`);
const modifierTargetBundle=sql(`select private.build_admin_catalog_bundle_v1('${T}'::uuid,10,now())::text`);
sql(`insert into public.catalog_publish_versions(
business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json)
values ('${B}','${S}',4,4,'BASELINE',${quoteJson(modifierSourceBundle)}),
       ('${B}','${T}',10,10,'BASELINE',${quoteJson(modifierTargetBundle)});
insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
values ('${S}',4,${quoteJson(modifierSourceBundle)}),
       ('${T}',10,${quoteJson(modifierTargetBundle)})
on conflict (shop_id,version) do nothing;`,'modifier-definitions publication fixtures');
const modifierDefinitionDraft=rpc(
  `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,10,'Mapped modifier definitions')`,
  'create target modifier definitions draft');
if(!modifierDefinitionDraft.ok||!modifierDefinitionDraft.draftId)
  throw new Error('Could not create modifier definitions draft: '+JSON.stringify(modifierDefinitionDraft));
const modifierDefinitionArgs=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
'${modifierDefinitionDraft.draftId}'::uuid,4::bigint,10::bigint,1::bigint,
array['modifierDefinitions']::text[]`;
sql(`delete from public.catalog_product_shop_overrides
where shop_id='${T}' and master_product_id='${BMP}'`,
  'deny missing standalone target master mapping');
assertDenied(
  rpc(`public.preview_admin_catalog_shop_copy_v1(${modifierDefinitionArgs})`,
    'missing target modifier definition identity'),
  'catalog_copy_missing_target_dependencies',
);
sql(`insert into public.catalog_product_shop_overrides(
business_id,master_product_id,shop_id,canonical_product_id,price_minor,visible,manual_sold_out)
values ('${B}','${BMP}','${T}','${TBP}',6000,true,false)`,
  'restore target standalone product master mapping');
// Pricing authority is mandatory for both preview and apply, including for
// an otherwise authorized catalog editor with a target-shop assignment.
const nonPricingModifierArgs=modifierDefinitionArgs.replace(
  `'${OWNER}'::uuid`,`'${EDITOR}'::uuid`
);
let modifierPricingDenied=false;
try {
  rpc(`public.preview_admin_catalog_shop_copy_v1(${nonPricingModifierArgs})`,
      'non-pricing catalog editor modifier definitions');
} catch(error) {
  modifierPricingDenied=/TUX_ADMIN_CATALOG_FORBIDDEN/.test(String(error));
}
if(!modifierPricingDenied)
  throw new Error('Modifier definitions preview allowed a non-pricing editor');
const modifierDefinitionPreview=rpc(
  `public.preview_admin_catalog_shop_copy_v1(${modifierDefinitionArgs})`,
  'preview master-mapped modifier definitions');
if(!modifierDefinitionPreview.ok||modifierDefinitionPreview.mappedModifierDefinitions!==1||
   modifierDefinitionPreview.changedModifierDefinitions!==1||
   modifierDefinitionPreview.modifierDefinitionDifferences?.[0]?.targetModifierId!==TMI||
   modifierDefinitionPreview.modifierDefinitionDifferences?.[0]?.nameAfter!=='Source drink modifier'||
   modifierDefinitionPreview.modifierDefinitionDifferences?.[0]?.priceAfterMinor!==500)
  throw new Error('Modifier definition preview failed target identity mapping: '+
    JSON.stringify(modifierDefinitionPreview));
const defsBefore=sql(`select name||','||price_minor||','||sort_order from public.modifiers
where id='${TMI}'`);
if(defsBefore!=='Target drink modifier,600,8')
  throw new Error('Modifier preview mutated live target configuration: '+defsBefore);
const modifierDefinitionStaged=rpc(
  `public.apply_admin_catalog_shop_copy_v1(${modifierDefinitionArgs},
    '${modifierDefinitionPreview.fingerprint}','modifier-definition-copy-1')`,
  'stage selected modifier definitions');
if(!modifierDefinitionStaged.ok||modifierDefinitionStaged.draftRevision!==2||
   modifierDefinitionStaged.changedModifierDefinitions!==1)
  throw new Error('Modifier definitions staging failed: '+JSON.stringify(modifierDefinitionStaged));
const stagedDefinition=sql(`select
(mod.value->>'id')||','||(mod.value->>'standaloneProductId')||','||
(mod.value->>'name')||','||(mod.value->>'priceMinor')||','||(mod.value->>'sortOrder')
from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'modifiers') mod(value)
where d.id='${modifierDefinitionDraft.draftId}' and mod.value->>'id'='${TMI}'`);
if(stagedDefinition!==TMI+','+TBP+',Source drink modifier,500,3')
  throw new Error('Modifier definition draft lost target-local identity: '+stagedDefinition);
const targetOnlyDefinition=sql(`select count(*) from public.catalog_drafts d
cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'modifiers') mod(value)
where d.id='${modifierDefinitionDraft.draftId}'
and mod.value->>'id'='${TLOCAL_MOD}'
and mod.value->>'name'='Local-only modifier'
and mod.value->>'priceMinor'='700'`);
if(targetOnlyDefinition!=='1')
  throw new Error('Modifier copy replaced target-only modifier definition');
const modifierDefinitionPublished=rpc(
  `public.publish_catalog_draft_v1('${OWNER}'::uuid,
    '${modifierDefinitionDraft.draftId}'::uuid,2,10)`,
  'canonical target modifier definitions publish');
if(!modifierDefinitionPublished.ok||modifierDefinitionPublished.publishVersion!==11)
  throw new Error('Modifier definitions failed canonical publication: '+
    JSON.stringify(modifierDefinitionPublished));
const liveDefinition=sql(`select
name||','||price_minor||','||active||','||sort_order||','||standalone_product_id
from public.modifiers where id='${TMI}'`);
if(liveDefinition!=='Source drink modifier,500,true,3,'+TBP &&
   liveDefinition!=='Source drink modifier,500,t,3,'+TBP)
  throw new Error('Published modifier definition violated identity: '+liveDefinition);
const targetOnlyLive=sql(`select name||','||price_minor from public.modifiers
where id='${TLOCAL_MOD}'`);
if(targetOnlyLive!=='Local-only modifier,700')
  throw new Error('Target-only modifier definition was changed: '+targetOnlyLive);
const sourceDefinition=sql(`select name||','||price_minor from public.modifiers
where id='${SMI}'`);
if(sourceDefinition!=='Source drink modifier,500')
  throw new Error('Modifier source configuration was mutated: '+sourceDefinition);

// Recipe copy requires an explicit SAME-BUSINESS inventory master identity.
// It must NOT infer inventory correspondence from shop-local IDs or names,
// copy costing/ledger/movement balances, or mutate live rows before publish.
const SI='90000000-0000-4000-8000-000000000001';
const TI='90000000-0000-4000-8000-000000000002';
const TIL='90000000-0000-4000-8000-000000000003';
const MI='91000000-0000-4000-8000-000000000001';
sql(`insert into public.inventory_items(
 id,shop_id,name,unit_label,tracking_mode,active)
 values ('${SI}','${S}','Burger flour','g','RECIPE_TRACKED',true),
        ('${TI}','${T}','Flour local','g','RECIPE_TRACKED',true),
        ('${TIL}','${T}','Sauce local','ml','RECIPE_TRACKED',true);
 insert into public.recipe_lines(shop_id,product_id,inventory_item_id,quantity_micros)
 values ('${S}','${P1}','${SI}',2500000),
        ('${T}','${TCLOCAL}','${TIL}',500000);`,
  'source and target recipe items with different shop-local IDs');
const recipeSourceBundle=sql(`select private.build_admin_catalog_bundle_v1('${S}'::uuid,5,now())::text`);
const recipeTargetBundle=sql(`select private.build_admin_catalog_bundle_v1('${T}'::uuid,12,now())::text`);
sql(`insert into public.catalog_publish_versions(
 business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json)
 values ('${B}','${S}',5,5,'BASELINE',${quoteJson(recipeSourceBundle)}),
        ('${B}','${T}',12,12,'BASELINE',${quoteJson(recipeTargetBundle)});
 insert into public.operations_configuration_snapshots(shop_id,version,bundle_json)
 values ('${S}',5,${quoteJson(recipeSourceBundle)}),
        ('${T}',12,${quoteJson(recipeTargetBundle)})
 on conflict (shop_id,version) do nothing;`,
  'isolated canonical recipe publication baselines');
const recipeDraft=rpc(
 `public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,12,'Master-mapped recipe copy')`,
 'create target recipe draft');
if(!recipeDraft.ok||!recipeDraft.draftId)
 throw new Error('Could not create recipe target draft: '+JSON.stringify(recipeDraft));
const recipeParams=`'${OWNER}'::uuid,'${S}'::uuid,'${T}'::uuid,
'${recipeDraft.draftId}'::uuid,5::bigint,12::bigint,1::bigint,
array['recipeLines']::text[]`;
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${recipeParams})`,
 'recipe missing approved master mapping'),'catalog_copy_missing_target_dependencies');
sql(`insert into public.catalog_master_inventory_items
 (id,business_id,canonical_name,base_unit_label,tracking_mode)
 values ('${MI}','${B}','Flour','g','RECIPE_TRACKED');
 insert into public.catalog_inventory_item_shop_bindings
 (business_id,master_inventory_item_id,shop_id,inventory_item_id)
 values ('${B}','${MI}','${S}','${SI}'),
        ('${B}','${MI}','${T}','${TI}');`,
  'explicit same-business inventory item master bindings');
const acl=sql(`select has_table_privilege('anon','public.catalog_inventory_item_shop_bindings','SELECT')
 ||','||has_table_privilege('authenticated','public.catalog_inventory_item_shop_bindings','SELECT')
 ||','||has_table_privilege('service_role','public.catalog_inventory_item_shop_bindings','SELECT')`);
if(acl!=='false,false,true')throw new Error('Inventory mapping grants breached: '+acl);
sql(`update public.inventory_items set unit_label='kg' where id='${TI}'`,
  'simulate target inventory unit drift after target publish');
assertDenied(rpc(`public.preview_admin_catalog_shop_copy_v1(${recipeParams})`,
 'recipe incompatible target unit'),'catalog_copy_incompatible_inventory_units');
sql(`update public.inventory_items set unit_label='g' where id='${TI}'`,
  'restore target base unit');
const recipePreview=rpc(`public.preview_admin_catalog_shop_copy_v1(${recipeParams})`,
  'preview mapped recipe lines');
if(!recipePreview.ok||recipePreview.mappedRecipeLines!==1||
   recipePreview.changedRecipeLines!==1||
   recipePreview.recipeDifferences?.[0]?.targetProductId!==P2||
   recipePreview.recipeDifferences?.[0]?.targetInventoryItemId!==TI||
   recipePreview.recipeDifferences?.[0]?.quantityAfterMicros!==2500000)
 throw new Error('Recipe source→target unit-safe remap preview failed: '+
   JSON.stringify(recipePreview));
const recipeStaged=rpc(`public.apply_admin_catalog_shop_copy_v1(
  ${recipeParams},'${recipePreview.fingerprint}','recipe-copy-1')`,
  'stage mapped recipe');
if(!recipeStaged.ok||recipeStaged.draftRevision!==2||
   recipeStaged.changedRecipeLines!==1)
 throw new Error('Recipe copy draft CAS apply failed: '+JSON.stringify(recipeStaged));
const recipeLiveBefore=sql(`select count(*) from public.recipe_lines
 where shop_id='${T}' and product_id='${P2}'`);
if(recipeLiveBefore!=='0')throw new Error('Recipe copy mutated live recipe before publish');
const stagedRecipe=sql(`select
 (r.value->>'productId')||','||(r.value->>'inventoryItemId')||','||(r.value->>'quantityMicros')
 from public.catalog_drafts d
 cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'recipeLines') r(value)
 where d.id='${recipeDraft.draftId}' and r.value->>'productId'='${P2}'`);
if(stagedRecipe!==P2+','+TI+',2500000')
 throw new Error('Source inventory ID leaked into target draft recipe: '+stagedRecipe);
const stagedLocalRecipe=sql(`select count(*) from public.catalog_drafts d
 cross join lateral jsonb_array_elements(d.working_bundle_json->'snapshot'->'recipeLines') r(value)
 where d.id='${recipeDraft.draftId}' and r.value->>'productId'='${TCLOCAL}'
 and r.value->>'inventoryItemId'='${TIL}' and r.value->>'quantityMicros'='500000'`);
if(stagedLocalRecipe!=='1')throw new Error('Target-only recipe lost from staged draft');
const recipePublish=rpc(`public.publish_catalog_draft_v1(
 '${OWNER}'::uuid,'${recipeDraft.draftId}'::uuid,2,12)`,
 'publish target recipe through catalog authority');
if(!recipePublish.ok||recipePublish.publishVersion!==13)
 throw new Error('Target recipe publication failed: '+JSON.stringify(recipePublish));
const actualRecipe=sql(`select inventory_item_id||','||quantity_micros
 from public.recipe_lines where shop_id='${T}' and product_id='${P2}'`);
if(actualRecipe!==TI+',2500000')
 throw new Error('Published recipe uses wrong target item/quantity: '+actualRecipe);
const localRecipe=sql(`select inventory_item_id||','||quantity_micros
 from public.recipe_lines where shop_id='${T}' and product_id='${TCLOCAL}'`);
if(localRecipe!==TIL+',500000')
 throw new Error('Target-only recipe was overwritten: '+localRecipe);
const originalRecipe=sql(`select inventory_item_id||','||quantity_micros
 from public.recipe_lines where shop_id='${S}' and product_id='${P1}'`);
if(originalRecipe!==SI+',2500000')
 throw new Error('Source recipe changed during target copy: '+originalRecipe);

// Inventory-master binding is an explicit authorized operator decision,
// not a guessed same-name match. It is command-idempotent and tenant scoped.
const SAUCE_SOURCE='90000000-0000-4000-8000-000000000004';
sql(`insert into public.inventory_items(id,shop_id,name,unit_label,tracking_mode,active)
values ('${SAUCE_SOURCE}','${S}','Sauce (source)','ml','RECIPE_TRACKED',true)`,
'second-shop recipe item fixture');
const createMasterArgs=`'${OWNER}'::uuid,'${T}'::uuid,'${TIL}'::uuid,
null::uuid,'Sauce master'::text,'bind-sauce-1'::text`;
const masterCreated=rpc(
`public.bind_admin_inventory_master_v1(${createMasterArgs})`,
'create business master for target sauce');
if(!masterCreated.ok||!masterCreated.masterInventoryItemId)
throw new Error('Inventory master creation failed: '+JSON.stringify(masterCreated));
const masterId=masterCreated.masterInventoryItemId;
const createReplay=rpc(
`public.bind_admin_inventory_master_v1(${createMasterArgs})`,
'idempotent master creation');
if(!createReplay.ok||!createReplay.replayed||
   createReplay.masterInventoryItemId!==masterId)
throw new Error('Master create replay duplicated or changed binding: '+JSON.stringify(createReplay));
assertDenied(rpc(`public.bind_admin_inventory_master_v1(
'${OWNER}'::uuid,'${T}'::uuid,'${TI}'::uuid,null::uuid,
'Sauce master'::text,'bind-sauce-1'::text)`,
'command ID reused for different inventory item'),'command_id_conflict');
const listed=rpc(
`public.list_admin_inventory_masters_v1('${OWNER}'::uuid,'${T}'::uuid)`,
'authorized master listing');
if(!listed.ok||!listed.masters?.some(row=>row.id===masterId &&
    row.inventoryItemId===TIL && row.baseUnitLabel==='ml'))
throw new Error('Master list missing canonical binding: '+JSON.stringify(listed));
sql(`update public.inventory_items set unit_label='g'
where id='${SAUCE_SOURCE}'`, 'simulate a non-matching unbound base unit');
assertDenied(rpc(`public.bind_admin_inventory_master_v1(
'${OWNER}'::uuid,'${S}'::uuid,'${SAUCE_SOURCE}'::uuid,
'${masterId}'::uuid,null::text,'bind-wrong-unit'::text)`,
'deny grams-to-milliliters mapping'),'catalog_inventory_master_unit_conflict');
sql(`update public.inventory_items set unit_label='ml'
where id='${SAUCE_SOURCE}'`, 'restore original inventory item unit');
const attached=rpc(`public.bind_admin_inventory_master_v1(
'${OWNER}'::uuid,'${S}'::uuid,'${SAUCE_SOURCE}'::uuid,
'${masterId}'::uuid,null::text,'bind-sauce-source-1'::text)`,
'attach source shop local sauce to existing master');
if(!attached.ok||attached.masterInventoryItemId!==masterId)
throw new Error('Cross-shop inventory binding failed: '+JSON.stringify(attached));
const sameMasterCount=sql(`select count(*)
from public.catalog_inventory_item_shop_bindings
where master_inventory_item_id='${masterId}'`);
if(sameMasterCount!=='2')throw new Error('Inventory master did not link two shops');
const suspiciousBindings=sql(`select count(*)
from public.catalog_inventory_item_shop_bindings
where inventory_item_id in ('${SI}','${TI}')
and master_inventory_item_id='${masterId}'`);
if(suspiciousBindings!=='0')throw new Error('Inventory master silently reassigned existing items');
sql(`insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect)
values ('${B}','${EDITOR}','inventory.adjust','ALLOW'),
('${B}','${EDITOR}','catalog.edit','ALLOW') on conflict do nothing`,
'non-owner manager permissions fixture');
let managerDenied=false;
try {rpc(`public.bind_admin_inventory_master_v1(
'${EDITOR}'::uuid,'${S}'::uuid,'${SI}'::uuid,
'${MI}'::uuid,null::text,'bind-manager-1'::text)`,
'manager cannot mutate master identity');}
catch(error){managerDenied=/TUX_ADMIN_CATALOG_FORBIDDEN|inventory_master_owner_required/.test(String(error));}
if(!managerDenied)throw new Error('Non-owner mutated business-wide inventory identity');
const mismatchedRowCount=sql(`select count(*)
from public.catalog_inventory_item_shop_bindings
where master_inventory_item_id='${masterId}'`);
if(mismatchedRowCount!=='2')throw new Error('Rejected command mutated the inventory bindings');
const masterAudit=sql(`select count(*) from public.admin_audit_events
where action_type='INVENTORY_MASTER_BOUND' and entity_id='${masterId}'`);
if(masterAudit!=='2')throw new Error('Canonical inventory-master audit must be once per mutation');

// Database uniqueness must enforce the same case/whitespace-insensitive
// invariant as the trusted bind RPC even under concurrent independent commands.
sql(`do $master_unique$ begin
  begin
    insert into public.catalog_master_inventory_items
      (business_id,canonical_name,base_unit_label,tracking_mode)
    values ('${B}','  SAUCE MASTER  ','ml','RECIPE_TRACKED');
    raise exception 'normalized_duplicate_inventory_master_accepted';
  exception when unique_violation then
    null;
  end;
end $master_unique$;`,'database-level master-name uniqueness');

const normalizedMasterCount=sql(`select count(*) from public.catalog_master_inventory_items
where business_id='${B}' and lower(btrim(canonical_name))='sauce master'`);
if(normalizedMasterCount!=='1')
  throw new Error('Inventory master logical identity split by case or spaces');

// A logical ingredient name remains reusable by a different business tenant.
sql(`insert into public.catalog_master_inventory_items
  (business_id,canonical_name,base_unit_label,tracking_mode)
values ('${B2}',' sauce master ','ml','RECIPE_TRACKED')`,
  'independent tenant may use the same logical master name');
const otherTenantCount=sql(`select count(*) from public.catalog_master_inventory_items
where business_id='${B2}' and lower(btrim(canonical_name))='sauce master'`);
if(otherTenantCount!=='1')throw new Error('Unique master name scope crossed business boundary');

console.log('Catalog Copy isolated PostgreSQL: preview, master mapping, inactive/missing dependency, draft-only apply, once-only audit, ACL and canonical target publication passed.');
