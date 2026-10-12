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
const migration='20261012044858_admin_catalog_copy_existing_master_products.sql';
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
('${C2}','${T}','burgers','Burgers',0,true);
insert into public.products(id,shop_id,category_id,slug,name,price_minor,active,sold_out,is_combo,sort_order)
values ('${P1}','${S}','${C1}','burger','Burger',12000,true,true,false,0),
('${P2}','${T}','${C2}','burger','Burger',22000,true,false,false,0);
insert into public.catalog_master_categories(id,business_id,canonical_name)
values ('${MC}','${B}','Burgers');
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
sql(`insert into public.operations_configuration_snapshots(
shop_id,version,bundle_json
) values
('${S}',1,${quoteJson(sourceBundle)}),
('${T}',1,${quoteJson(targetBundle)})`,'operations baseline snapshot fixtures');
sql(`insert into public.catalog_publish_versions(
business_id,shop_id,publish_version,operations_configuration_version,source_kind,bundle_json
) values
('${B}','${S}',1,1,'BASELINE',${quoteJson(sourceBundle)}),
('${B}','${T}',1,1,'BASELINE',${quoteJson(targetBundle)})`,'publish fixtures');
const draft=rpc(`public.create_catalog_draft_v1('${OWNER}'::uuid,'${T}'::uuid,1,'Copy target')`,'draft create');
if(!draft.ok || !draft.draftId)throw new Error('Could not create canonical draft: '+JSON.stringify(draft));
const params=(from=S,to=T,revision=1,sourceVersion=1,domains="array['productPrices','productAvailability']::text[]")=>
`'${OWNER}'::uuid,'${from}'::uuid,'${to}'::uuid,'${draft.draftId}'::uuid,
${sourceVersion}::bigint,1::bigint,${revision}::bigint,${domains}`;
const preview=rpc(`public.preview_admin_catalog_shop_copy_v1(${params()})`,'preview');
if(!preview.ok || preview.mappedProducts!==1 || preview.changedProducts!==1 ||
   !/^[0-9a-f]{64}$/.test(preview.fingerprint))
throw new Error('Expected one mapped changed product: '+JSON.stringify(preview));
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
const auditCount=sql(`select count(*) from public.admin_audit_events where action_type='CATALOG_COPY_STAGED'`);
if(auditCount!=='1')throw new Error('Catalog copy audit not append-only or once-only');
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
console.log('Catalog Copy isolated PostgreSQL: preview, master mapping, inactive/missing dependency, draft-only apply, once-only audit, ACL and canonical target publication passed.');
