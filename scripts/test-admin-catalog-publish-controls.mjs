import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910112000_admin_catalog_publish_controls.sql';
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const name of [
  'restored_from_publish_version',
  'schedule_catalog_draft_v1',
  'cancel_scheduled_config_change_v1',
  'restore_catalog_publish_version_v1',
  'africa/cairo',
]) {
  if (!sql.includes(name)) {
    throw new Error(`admin catalog publish controls migration missing ${name}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog publish controls static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog publish controls behavioral test refuses non-loopback PostgreSQL.');
}

const shopId = '17000000-0000-4000-8000-000000000001';
const employeeId = '27000000-0000-4000-8000-000000000001';
const categoryId = '37000000-0000-4000-8000-000000000001';
const productId = '47000000-0000-4000-8000-000000000001';
const businessId = '00000000-0000-4000-8000-000000000001';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Admin Catalog Publish Fixture', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Catalog Publish Fixture Owner', 'OWNER', true);

insert into public.menu_categories(
  id, shop_id, slug, name, description, sort_order, active
) values (
  '${categoryId}', '${shopId}', 'publish-burgers', 'Publish Burgers',
  'Publish fixture category', 0, true
);

insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'publish-burger', 'Publish Burger',
  'Publish fixture product', 1000, null, 'FIXTURE', false, true, false, false, 0
);

do $$
declare
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_immediate jsonb;
  v_restore jsonb;
  v_stale_restore jsonb;
  v_schedule jsonb;
  v_schedule_replay jsonb;
  v_cancel jsonb;
  v_cancel_replay jsonb;
  v_draft_id uuid;
  v_schedule_id uuid;
  v_bundle jsonb;
  v_version_one_snapshot jsonb;
  v_version_one_snapshot_after jsonb;
  v_count integer;
begin
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 0, 'Publish controls base'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'publish-controls draft creation failed: %', v_create;
  end if;

  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,priceMinor}',
    '1500'::jsonb,
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'publish-controls draft update failed: %', v_apply;
  end if;

  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 0
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 1 then
    raise exception 'publish-controls initial publish failed: %', v_publish;
  end if;

  select v.bundle_json into v_version_one_snapshot
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.publish_version = 1;

  v_immediate := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 2 then
    raise exception 'publish-controls immediate availability failed: %', v_immediate;
  end if;

  v_restore := public.restore_catalog_publish_version_v1(
    '${employeeId}', '${shopId}', 1, 2
  );
  if coalesce((v_restore ->> 'ok')::boolean, false) is not true
     or (v_restore ->> 'sourcePublishVersion')::bigint <> 1
     or (v_restore ->> 'publishVersion')::bigint <> 3
     or (v_restore ->> 'operationsConfigurationVersion')::integer <> 3 then
    raise exception 'catalog restore-as-new-version failed: %', v_restore;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}'
      and p.shop_id = '${shopId}'
      and p.price_minor = 1500
      and p.sold_out = false
  ) then
    raise exception 'restore did not materialize historical content as current canonical state';
  end if;

  if not exists (
    select 1 from public.catalog_publish_versions v
    where v.shop_id = '${shopId}'
      and v.publish_version = 3
      and v.source_kind = 'ROLLBACK'
      and v.restored_from_publish_version = 1
  ) then
    raise exception 'restore did not append rollback lineage';
  end if;

  select v.bundle_json into v_version_one_snapshot_after
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.publish_version = 1;
  if v_version_one_snapshot_after is distinct from v_version_one_snapshot then
    raise exception 'restore rewrote historical publish content';
  end if;

  v_stale_restore := public.restore_catalog_publish_version_v1(
    '${employeeId}', '${shopId}', 1, 2
  );
  if v_stale_restore ->> 'code' <> 'stale_version'
     or (v_stale_restore ->> 'currentVersion')::bigint <> 3 then
    raise exception 'stale restore was not fenced: %', v_stale_restore;
  end if;

  select count(*) into v_count
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}';
  if v_count <> 3 then
    raise exception 'stale restore unexpectedly appended history';
  end if;

  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 3, 'Future scheduled price'
  );
  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,priceMinor}',
    '1750'::jsonb,
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'scheduled draft update failed: %', v_apply;
  end if;

  v_schedule := public.schedule_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 3, timestamp '2099-09-11 08:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog schedule creation failed: %', v_schedule;
  end if;
  v_schedule_id := (v_schedule ->> 'scheduleId')::uuid;

  if not exists (
    select 1 from public.scheduled_config_changes s
    where s.id = v_schedule_id
      and s.shop_id = '${shopId}'
      and s.change_kind = 'CATALOG_PUBLISH'
      and s.status = 'PENDING'
      and s.timezone = 'Africa/Cairo'
      and s.local_scheduled_at = timestamp '2099-09-11 08:00:00'
      and s.scheduled_for = timestamp '2099-09-11 08:00:00' at time zone 'Africa/Cairo'
      and s.target_base_publish_version = 3
      and s.payload_json ->> 'draftId' = v_draft_id::text
      and (s.payload_json ->> 'expectedDraftRevision')::bigint = 2
  ) then
    raise exception 'catalog schedule did not persist Cairo/version-safe execution intent';
  end if;

  v_schedule_replay := public.schedule_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 3, timestamp '2099-09-11 08:00:00'
  );
  if coalesce((v_schedule_replay ->> 'ok')::boolean, false) is not true
     or coalesce((v_schedule_replay ->> 'idempotentReplay')::boolean, false) is not true
     or (v_schedule_replay ->> 'scheduleId')::uuid <> v_schedule_id then
    raise exception 'catalog schedule replay was not idempotent: %', v_schedule_replay;
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes s
  where s.shop_id = '${shopId}' and s.change_kind = 'CATALOG_PUBLISH';
  if v_count <> 1 then
    raise exception 'catalog schedule replay duplicated durable work';
  end if;

  v_cancel := public.cancel_scheduled_config_change_v1(
    '${employeeId}', '${shopId}', v_schedule_id
  );
  if coalesce((v_cancel ->> 'ok')::boolean, false) is not true
     or v_cancel ->> 'status' <> 'CANCELLED' then
    raise exception 'catalog schedule cancellation failed: %', v_cancel;
  end if;

  v_cancel_replay := public.cancel_scheduled_config_change_v1(
    '${employeeId}', '${shopId}', v_schedule_id
  );
  if coalesce((v_cancel_replay ->> 'ok')::boolean, false) is not true
     or coalesce((v_cancel_replay ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'catalog schedule cancellation replay failed: %', v_cancel_replay;
  end if;
end $$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.schedule_catalog_draft_v1(uuid,uuid,bigint,bigint,timestamp without time zone)',
    'public.cancel_scheduled_config_change_v1(uuid,uuid,uuid)',
    'public.restore_catalog_publish_version_v1(uuid,uuid,bigint,bigint)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'Admin publish-control RPC % leaked browser EXECUTE privilege', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Admin publish-control RPC % missing service_role EXECUTE privilege', v_function;
    end if;
  end loop;
end $$;


-- Price-approval regression runs inside isolated local PostgreSQL only.
do $$
declare
  v_business uuid:='00000000-0000-4000-8000-000000000001';
  v_shop uuid:='17000000-0000-4000-8000-000000000001';
  v_requester uuid:='27000000-0000-4000-8000-000000000001';
  v_approver uuid:='27000000-0000-4000-8000-000000000002';
  v_rule uuid:='57000000-0000-4000-8000-000000000001';
  v_command uuid:='58000000-0000-4000-8000-000000000001';
  v_schedule_draft uuid;
  v_target_draft uuid;
  v_request uuid;
  v_claim record;
  v_draft jsonb;
  v_apply jsonb;
  v_preview jsonb;
  v_out jsonb;
  v_payload jsonb;
  v_fingerprint text;
  v_impact bigint;
  v_receipt_count int;
  v_mixed_impact bigint;
begin
  insert into public.business_employees(id,business_id,display_name,role,active)
   values(v_approver,v_business,'Price approval reviewer','OWNER',true);
  insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
   values(v_business,v_approver,v_shop);

  -- Future schedule accepted before rule activation; executor must still fence
  -- it when high-impact approval becomes mandatory.
  v_draft:=public.create_catalog_draft_v1(v_requester,v_shop,3,'Price future schedule');
  v_schedule_draft:=(v_draft->>'draftId')::uuid;
  v_apply:=public.apply_catalog_draft_change_v1(
    v_requester,v_schedule_draft,1,
    jsonb_build_object('bundleJson',jsonb_set(
      v_draft->'bundleJson','{snapshot,products,0,priceMinor}',
      '9900'::jsonb,false)));
  if v_apply->>'ok' is distinct from 'true' then
    raise exception 'Catalog future price draft failed: %',v_apply;
  end if;
  v_out:=public.schedule_catalog_draft_v1(
    v_requester,v_schedule_draft,2,3,timestamp '2099-09-11 09:00:00');
  if v_out->>'ok' is distinct from 'true' then
    raise exception 'Cannot accept pre-rule catalog schedule: %',v_out;
  end if;

  v_draft:=public.create_catalog_draft_v1(v_requester,v_shop,3,'Price publish approval');
  v_target_draft:=(v_draft->>'draftId')::uuid;
  v_apply:=public.apply_catalog_draft_change_v1(
    v_requester,v_target_draft,1,
    jsonb_build_object('bundleJson',jsonb_set(
      v_draft->'bundleJson','{snapshot,products,0,priceMinor}',
      '9000'::jsonb,false)));
  if v_apply->>'ok' is distinct from 'true' then
    raise exception 'Catalog price approval draft failed: %',v_apply;
  end if;

  insert into public.admin_approval_rules(
    id,business_id,shop_id,action_type,requester_permission,approver_permission,
    requires_second_person,threshold_context,active
  ) values (
    v_rule,v_business,null,'CATALOG_PRICE_PUBLISH','catalog.pricing',
    'approvals.review',true,'{"minimumMinor":5000}'::jsonb,true
  );

  if private.admin_catalog_price_requires_approval_v1(v_business,v_shop,4999)
    or not private.admin_catalog_price_requires_approval_v1(v_business,v_shop,5000)
    or not private.admin_catalog_price_requires_approval_v1(v_business,v_shop,5001) then
    raise exception 'Catalog price policy did not enforce below/equal/above threshold';
  end if;
  v_out:=public.publish_catalog_draft_scheduled_v1(
    v_requester,v_schedule_draft,2,3);
  if v_out->>'code' <> 'catalog_price_approval_required' then
    raise exception 'Pre-existing high-price schedule bypassed approval: %',v_out;
  end if;
  v_preview:=public.preview_admin_catalog_price_publish_v1(
    v_requester,v_target_draft,2,3);
  if v_preview->>'ok' is distinct from 'true'
     or (v_preview->>'maxPriceDeltaMinor')::bigint<>7500
     or v_preview->>'candidateFingerprint' !~ '^[a-f0-9]{32}$' then
    raise exception 'Trusted catalog price preview invalid: %',v_preview;
  end if;
  v_impact:=(v_preview->>'maxPriceDeltaMinor')::bigint;
  v_fingerprint:=v_preview->>'candidateFingerprint';
  v_out:=public.publish_catalog_draft_v1(v_requester,v_target_draft,2,3);
  if v_out->>'code'<>'catalog_price_approval_required' then
    raise exception 'Catalog direct price approval bypass: %',v_out;
  end if;
  v_out:=public.schedule_catalog_draft_v1(
    v_requester,v_target_draft,2,3,timestamp '2099-09-11 10:00:00');
  if v_out->>'code'<>'catalog_price_approval_required' then
    raise exception 'New price schedule approval bypass: %',v_out;
  end if;

  v_payload:=jsonb_build_object(
    'shopId',v_shop,'draftId',v_target_draft,'expectedDraftRevision',2,
    'expectedVersion',3,'maxPriceDeltaMinor',v_impact,
    'candidateFingerprint',v_fingerprint);
  v_out:=public.create_admin_approval_request_v1(
    v_business,v_shop,v_requester,null,v_rule,'CATALOG_PRICE_PUBLISH',
    v_command,v_payload,'High price publication');
  if v_out->>'ok' is distinct from 'true' then
    raise exception 'Catalog approval request rejected: %',v_out;
  end if;
  v_request:=(v_out->>'requestId')::uuid;
  update public.admin_approval_rules set active=false where id=v_rule;
  v_out:=public.publish_catalog_draft_v1(v_requester,v_target_draft,2,3);
  if v_out->>'code'<>'catalog_price_approval_required' then
    raise exception 'Catalog pending rule-off bypass: %',v_out;
  end if;
  update public.admin_approval_rules set active=true where id=v_rule;

  v_out:=public.decide_admin_approval_request_v1(
    v_request,v_approver,null,'APPROVE','Approved');
  if v_out->>'ok' is distinct from 'true' then
    raise exception 'Catalog price second person denied: %',v_out;
  end if;
  select * into v_claim from public.claim_admin_approval_execution_v1(
    'catalog-price-test',now(),10,300)
   where approval_request_id=v_request;
  if not found then raise exception 'Catalog price command not claimed'; end if;
  v_out:=public.execute_approved_admin_catalog_price_publish_v1(
    v_request,v_business,v_shop,v_requester,v_requester,
    v_target_draft,2,3,v_impact,v_fingerprint,v_command);
  if v_out->>'code'<>'approval_catalog_price_payload_or_state_mismatch' then
    raise exception 'Self approval accepted for catalog pricing: %',v_out;
  end if;
  v_out:=public.execute_approved_admin_catalog_price_publish_v1(
    v_request,v_business,v_shop,v_requester,v_approver,
    v_target_draft,2,3,v_impact,'00000000000000000000000000000000',v_command);
  if v_out->>'code'<>'approval_catalog_price_payload_or_state_mismatch' then
    raise exception 'Catalog price tampered digest accepted: %',v_out;
  end if;
  v_out:=public.execute_approved_admin_catalog_price_publish_v1(
    v_request,v_business,v_shop,v_requester,v_approver,
    v_target_draft,2,3,v_impact,v_fingerprint,v_command);
  if v_out->>'ok' is distinct from 'true' or (v_out->>'publishVersion')::bigint<>4 then
    raise exception 'Approved catalog price publish failed: %',v_out;
  end if;
  v_out:=public.execute_approved_admin_catalog_price_publish_v1(
    v_request,v_business,v_shop,v_requester,v_approver,
    v_target_draft,2,3,v_impact,v_fingerprint,v_command);
  if v_out->>'ok' is distinct from 'true' or v_out->>'idempotentReplay'<>'true' then
    raise exception 'Catalog price approval replay not once-only: %',v_out;
  end if;
  v_out:=public.complete_admin_approval_execution_v1(
    v_request,v_claim.claim_token,'EXECUTED',null,'{}'::jsonb,now());
  if v_out->>'ok' is distinct from 'true' then
    raise exception 'Catalog price approval completion missing: %',v_out;
  end if;
  select count(*) into v_receipt_count
  from private.admin_catalog_price_publish_approval_receipts
  where shop_id=v_shop;
  if v_receipt_count<>1 then
    raise exception 'Catalog price duplicated protected receipt: %',v_receipt_count;
  end if;
  select private.admin_catalog_price_max_delta_v1(
    v_shop,jsonb_build_object(
      'snapshot',jsonb_build_object(
        'products',jsonb_build_array(
          jsonb_build_object('id','47000000-0000-4000-8000-000000000001',
            'priceMinor',2000)),
        'modifiers',jsonb_build_array(
          jsonb_build_object('id','99000000-0000-4000-8000-000000000001',
            'priceMinor',7200))
      )
    )
  ) into v_mixed_impact;
  if v_mixed_impact<>7200 then
    raise exception 'Catalog mixed product/modifier price impact must use maximum trusted delta: %',v_mixed_impact;
  end if;
  v_out:=public.restore_catalog_publish_version_v1(v_requester,v_shop,1,4);
  if v_out->>'code'<>'catalog_price_approval_required' then
    raise exception 'Historical high-price rollback bypassed approval: %',v_out;
  end if;
  if (select price_minor from public.products
     where shop_id=v_shop and id='47000000-0000-4000-8000-000000000001')<>9000 then
    raise exception 'Approved catalog price did not publish exact price';
  end if;
end $$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'public.preview_admin_catalog_price_publish_v1(uuid,uuid,bigint,bigint)',
    'public.execute_approved_admin_catalog_price_publish_v1(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid)',
    'private.admin_catalog_price_max_delta_v1(uuid,jsonb)',
    'private.admin_catalog_price_requires_approval_v1(uuid,uuid,bigint)'
  ] loop
    if has_function_privilege('anon',v_signature,'EXECUTE')
      or has_function_privilege('authenticated',v_signature,'EXECUTE')
      or not has_function_privilege('service_role',v_signature,'EXECUTE') then
      raise exception 'Unsafe catalog price RPC privileges: %',v_signature;
    end if;
  end loop;
end $$;


-- Same chain in a second business/shop ensures admin catalog versions,
-- live menu products and Operations snapshots never leak between shops.
insert into public.businesses(id,name)
values ('00000000-0000-4000-8000-000000000002','Catalog isolated second tenant');
insert into public.shops(id,name,active)
values ('17000000-0000-4000-8000-000000000002','Catalog isolated second shop',true);
insert into public.business_shops(business_id,shop_id)
values ('00000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000002');
insert into public.business_employees(id,business_id,display_name,role,active)
values ('27000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000002','Shop B catalog OWNER','OWNER',true);
insert into public.menu_categories(id,shop_id,slug,name,description,sort_order,active)
values ('37000000-0000-4000-8000-000000000002',
        '17000000-0000-4000-8000-000000000002',
        'catalog-b-category','Tenant B category','Isolated fixture',0,true);
insert into public.products(
  id,shop_id,category_id,slug,name,description,price_minor,image_key,
  family,best_seller,active,sold_out,is_combo,sort_order
) values (
  '47000000-0000-4000-8000-000000000002',
  '17000000-0000-4000-8000-000000000002',
  '37000000-0000-4000-8000-000000000002',
  'catalog-b-product','Tenant B Product','Isolated fixture',2200,null,
  'FIXTURE',false,true,false,false,0
);

do $catalog_two_businesses$
declare
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_draft_id uuid;
  v_bundle jsonb;
  v_a_version bigint;
  v_a_ops integer;
  v_a_product_price bigint;
begin
  select coalesce(max(publish_version),0) into v_a_version
    from public.catalog_publish_versions
    where shop_id='17000000-0000-4000-8000-000000000001';
  select coalesce(max(version),0) into v_a_ops
    from public.operations_configuration_snapshots
    where shop_id='17000000-0000-4000-8000-000000000001';
  select price_minor into v_a_product_price from public.products
    where id='47000000-0000-4000-8000-000000000001';
  v_create := public.create_catalog_draft_v1(
    '27000000-0000-4000-8000-000000000003',
    '17000000-0000-4000-8000-000000000002',0,'Tenant B own draft');
  if v_create->>'ok' is distinct from 'true' then
    raise exception 'Shop B draft creation failed: %',v_create;
  end if;
  v_draft_id := (v_create->>'draftId')::uuid;
  v_bundle := jsonb_set(v_create->'bundleJson',
    '{snapshot,products,0,priceMinor}','2300'::jsonb,false);
  v_apply := public.apply_catalog_draft_change_v1(
    '27000000-0000-4000-8000-000000000003',v_draft_id,1,
    jsonb_build_object('bundleJson',v_bundle));
  if v_apply->>'ok' is distinct from 'true' then
    raise exception 'Shop B draft staging failed: %',v_apply;
  end if;
  v_publish := public.publish_catalog_draft_v1(
    '27000000-0000-4000-8000-000000000003',v_draft_id,2,0);
  if v_publish->>'ok' is distinct from 'true'
     or (v_publish->>'publishVersion')::bigint <> 1 then
    raise exception 'Shop B publish failed: %',v_publish;
  end if;
  if (select price_minor from public.products
      where id='47000000-0000-4000-8000-000000000002') <> 2300 then
    raise exception 'Shop B published price not materialized';
  end if;
  if (select count(*) from public.catalog_publish_versions
      where shop_id='17000000-0000-4000-8000-000000000002') <> 1
    or (select count(*) from public.operations_configuration_snapshots
        where shop_id='17000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'Shop B catalog/Operations publication missing or duplicated';
  end if;
  if (select coalesce(max(publish_version),0)
      from public.catalog_publish_versions
      where shop_id='17000000-0000-4000-8000-000000000001') <> v_a_version
    or (select coalesce(max(version),0)
        from public.operations_configuration_snapshots
        where shop_id='17000000-0000-4000-8000-000000000001') <> v_a_ops
    or (select price_minor from public.products
        where id='47000000-0000-4000-8000-000000000001') <> v_a_product_price then
    raise exception 'Publishing shop B unexpectedly modified tenant A catalog or Operations';
  end if;
  if exists (
    select 1 from public.catalog_publish_versions
    where shop_id='17000000-0000-4000-8000-000000000001'
      and bundle_json::text like '%Tenant B Product%'
  ) then
    raise exception 'Tenant B product leaked into tenant A catalog history';
  end if;
end;
$catalog_two_businesses$;

rollback;
`;

const result = spawnSync(
  'psql',
  [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', behaviorSql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(`Admin catalog publish controls behavioral test failed with exit code ${result.status}.`);
}

console.log('Admin catalog publish controls static and PostgreSQL behavioral invariants passed.');
