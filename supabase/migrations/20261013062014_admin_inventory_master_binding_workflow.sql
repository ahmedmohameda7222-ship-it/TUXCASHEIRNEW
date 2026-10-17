-- Correction A: privileged, explicit, command-bound inventory-master bindings.
-- The admin may never infer a cross-shop match from names or write inventory
-- ledger, unit conversions, recipes or COGS as a side effect.
create table if not exists public.admin_inventory_master_binding_receipts (
 business_id uuid not null,
 shop_id uuid not null,
 command_id text not null check(length(command_id) between 1 and 160),
 actor_employee_id uuid not null,
 inventory_item_id uuid not null,
 master_inventory_item_id uuid not null,
 request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
 result_json jsonb not null,
 created_at timestamptz not null default now(),
 primary key(business_id,shop_id,command_id),
 foreign key(business_id,shop_id)
   references public.business_shops(business_id,shop_id) on delete restrict,
 foreign key(business_id,master_inventory_item_id)
   references public.catalog_master_inventory_items(business_id,id) on delete restrict,
 foreign key(shop_id,inventory_item_id)
   references public.inventory_items(shop_id,id) on delete restrict
);
alter table public.admin_inventory_master_binding_receipts enable row level security;
revoke all on public.admin_inventory_master_binding_receipts from public,anon,authenticated;
grant select,insert on public.admin_inventory_master_binding_receipts to service_role;

create or replace function public.list_admin_inventory_masters_v1(
 p_employee_id uuid,p_shop_id uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,private
as $master_list$
declare v_business uuid;
begin
 v_business:=private.assert_admin_catalog_permission_v1(
    p_employee_id,p_shop_id,'inventory.view');
 perform private.assert_admin_catalog_permission_v1(
    p_employee_id,p_shop_id,'inventory.adjust');
 perform private.assert_admin_catalog_permission_v1(
    p_employee_id,p_shop_id,'catalog.edit');
 if not exists(select 1 from public.business_employees e
   where e.id=p_employee_id and e.business_id=v_business and e.active
     and e.role in ('OWNER','ADMIN'))
 then raise exception 'inventory_master_owner_required'; end if;
 return jsonb_build_object('ok',true,'shopId',p_shop_id,
   'masters',coalesce((
     select jsonb_agg(jsonb_build_object(
       'id',master.id,
       'canonicalName',master.canonical_name,
       'baseUnitLabel',master.base_unit_label,
       'trackingMode',master.tracking_mode,
       'inventoryItemId',binding.inventory_item_id,
       'inventoryItemName',item.name
     ) order by master.canonical_name,master.id)
     from public.catalog_master_inventory_items master
     left join public.catalog_inventory_item_shop_bindings binding
       on binding.business_id=v_business
      and binding.master_inventory_item_id=master.id
      and binding.shop_id=p_shop_id
     left join public.inventory_items item on item.shop_id=p_shop_id
        and item.id=binding.inventory_item_id
     where master.business_id=v_business
   ),'[]'::jsonb));
end;
$master_list$;
revoke all on function public.list_admin_inventory_masters_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.list_admin_inventory_masters_v1(uuid,uuid)
  to service_role;

create or replace function public.bind_admin_inventory_master_v1(
 p_employee_id uuid,p_shop_id uuid,p_inventory_item_id uuid,
 p_master_inventory_item_id uuid,p_canonical_name text,p_command_id text
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,private
as $master_bind$
declare
 v_business uuid;
 v_item public.inventory_items%rowtype;
 v_master public.catalog_master_inventory_items%rowtype;
 v_existing uuid;
 v_master_id uuid;
 v_receipt public.admin_inventory_master_binding_receipts%rowtype;
 v_fingerprint text;
 v_result jsonb;
 v_name text:=nullif(btrim(p_canonical_name),'');
begin
 if p_employee_id is null or p_shop_id is null or
    p_inventory_item_id is null or
    nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 or
    ((p_master_inventory_item_id is null and (v_name is null or length(v_name)>160)) or
     (p_master_inventory_item_id is not null and p_canonical_name is not null))
 then return jsonb_build_object('ok',false,'code','invalid_inventory_master_binding'); end if;

 v_business:=private.assert_admin_catalog_permission_v1(
   p_employee_id,p_shop_id,'inventory.adjust');
 perform private.assert_admin_catalog_permission_v1(
   p_employee_id,p_shop_id,'inventory.view');
 perform private.assert_admin_catalog_permission_v1(
   p_employee_id,p_shop_id,'catalog.edit');
 if not exists(select 1 from public.business_employees e
   where e.id=p_employee_id and e.business_id=v_business and e.active
     and e.role in ('OWNER','ADMIN'))
 then raise exception 'inventory_master_owner_required'; end if;
 if not exists(select 1 from public.shops s
   where s.id=p_shop_id and s.active and s.lifecycle_state='ACTIVE')
 then return jsonb_build_object('ok',false,'code','inventory_master_shop_inactive'); end if;

 v_fingerprint:=encode(extensions.digest(jsonb_build_object(
   'employeeId',p_employee_id,'businessId',v_business,'shopId',p_shop_id,
   'inventoryItemId',p_inventory_item_id,
   'masterInventoryItemId',p_master_inventory_item_id,
   'canonicalName',v_name,'commandId',p_command_id
 )::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(
   'tux-admin-inventory-master-command:'||v_business::text||':'||
   p_shop_id::text||':'||p_command_id,0));
 select * into v_receipt from public.admin_inventory_master_binding_receipts
 where business_id=v_business and shop_id=p_shop_id
   and command_id=p_command_id for update;
 if found then
   if v_receipt.actor_employee_id is distinct from p_employee_id or
      v_receipt.inventory_item_id is distinct from p_inventory_item_id or
      v_receipt.request_fingerprint is distinct from v_fingerprint
   then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
   return v_receipt.result_json||jsonb_build_object('replayed',true);
 end if;

 perform pg_advisory_xact_lock(hashtextextended(
   'tux-admin-inventory-master-item:'||p_shop_id::text||':'||
   p_inventory_item_id::text,0));
 select * into v_item from public.inventory_items
   where id=p_inventory_item_id and shop_id=p_shop_id for share;
 if not found or v_item.active is distinct from true or
    v_item.tracking_mode<>'RECIPE_TRACKED' or
    nullif(btrim(v_item.unit_label),'') is null
 then return jsonb_build_object('ok',false,'code','inventory_master_item_incompatible'); end if;
 select master_inventory_item_id into v_existing
   from public.catalog_inventory_item_shop_bindings
   where inventory_item_id=p_inventory_item_id;
 if found then
   return jsonb_build_object('ok',false,'code','catalog_inventory_master_already_bound'); end if;

 if p_master_inventory_item_id is null then
   if exists(select 1 from public.catalog_master_inventory_items m
      where m.business_id=v_business
        and lower(btrim(m.canonical_name))=lower(v_name))
   then return jsonb_build_object('ok',false,'code','inventory_master_name_conflict'); end if;
   begin
     insert into public.catalog_master_inventory_items(
       business_id,canonical_name,base_unit_label,tracking_mode)
     values(v_business,v_name,v_item.unit_label,'RECIPE_TRACKED')
     returning id into v_master_id;
   exception when unique_violation then
     return jsonb_build_object('ok',false,'code','inventory_master_name_conflict');
   end;
 else
   select * into v_master from public.catalog_master_inventory_items
     where id=p_master_inventory_item_id and business_id=v_business for share;
   if not found then
     return jsonb_build_object('ok',false,'code','inventory_master_not_found'); end if;
   if v_master.base_unit_label is distinct from v_item.unit_label or
     v_master.tracking_mode<>'RECIPE_TRACKED' or exists(
       select 1 from public.catalog_inventory_item_shop_bindings b
         join public.inventory_items i
           on i.id=b.inventory_item_id and i.shop_id=b.shop_id
         where b.master_inventory_item_id=v_master.id and
          (i.active is distinct from true or i.unit_label is distinct from
             v_master.base_unit_label or i.tracking_mode<>'RECIPE_TRACKED')
     ) then return jsonb_build_object('ok',false,
       'code','catalog_inventory_master_unit_conflict'); end if;
   v_master_id:=v_master.id;
 end if;
 begin
  insert into public.catalog_inventory_item_shop_bindings(
    business_id,master_inventory_item_id,shop_id,inventory_item_id)
  values(v_business,v_master_id,p_shop_id,p_inventory_item_id);
 exception when unique_violation then
  return jsonb_build_object('ok',false,'code','catalog_inventory_master_binding_conflict');
 end;
 v_result:=jsonb_build_object('ok',true,
   'masterInventoryItemId',v_master_id,'inventoryItemId',p_inventory_item_id,
   'shopId',p_shop_id,'createdMaster',p_master_inventory_item_id is null);

 perform public.append_admin_audit_event_v1(
   v_business,p_shop_id,p_employee_id,'INVENTORY_MASTER_BOUND',
   'INVENTORY_MASTER',v_master_id::text,null,
   jsonb_build_object('inventoryItemId',p_inventory_item_id,
                      'baseUnitLabel',v_item.unit_label,
                      'createdMaster',p_master_inventory_item_id is null),
   'Explicit recipe inventory master mapping',null,null,
   jsonb_build_object('commandId',p_command_id));
 insert into public.admin_inventory_master_binding_receipts(
  business_id,shop_id,command_id,actor_employee_id,
  inventory_item_id,master_inventory_item_id,request_fingerprint,result_json)
 values(v_business,p_shop_id,p_command_id,p_employee_id,p_inventory_item_id,
        v_master_id,v_fingerprint,v_result);
 return v_result;
end;
$master_bind$;
revoke all on function public.bind_admin_inventory_master_v1(
  uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.bind_admin_inventory_master_v1(
  uuid,uuid,uuid,uuid,text,text) to service_role;
