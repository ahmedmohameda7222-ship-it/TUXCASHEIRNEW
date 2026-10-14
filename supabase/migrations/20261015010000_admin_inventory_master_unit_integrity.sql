-- Correction A: an approved recipe-inventory master link is a continuing
-- unit and tracking identity invariant, not only a one-time RPC validation.
-- Do not mutate balances, purchases, COGS, recipes or binding rows.
create or replace function private.guard_admin_inventory_master_binding_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $guard_binding$
declare
  v_master public.catalog_master_inventory_items%rowtype;
  v_item public.inventory_items%rowtype;
begin
  -- A canonical identity cannot be silently reassigned to a different
  -- shop/item/master by any privileged writer.
  if tg_op='UPDATE' and (
    new.business_id is distinct from old.business_id or
    new.master_inventory_item_id is distinct from old.master_inventory_item_id or
    new.shop_id is distinct from old.shop_id or
    new.inventory_item_id is distinct from old.inventory_item_id
  ) then
    raise exception using errcode='23514',
      message='catalog_inventory_master_rebind_forbidden';
  end if;
  select * into v_master
  from public.catalog_master_inventory_items
  where id=new.master_inventory_item_id and business_id=new.business_id
  for share;
  select * into v_item
  from public.inventory_items
  where id=new.inventory_item_id and shop_id=new.shop_id
  for share;
  if v_master.id is null or v_item.id is null or
     v_master.tracking_mode is distinct from 'RECIPE_TRACKED' or
     v_item.tracking_mode is distinct from v_master.tracking_mode or
     v_item.unit_label is distinct from v_master.base_unit_label or
     v_item.active is distinct from true
  then
    raise exception using errcode='23514',
      message='catalog_inventory_master_unit_conflict';
  end if;
  return new;
end;
$guard_binding$;

create or replace function private.guard_bound_inventory_item_unit_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $guard_item$
begin
  if (new.unit_label is distinct from old.unit_label or
      new.tracking_mode is distinct from old.tracking_mode) and exists (
    select 1
    from public.catalog_inventory_item_shop_bindings b
    join public.catalog_master_inventory_items master
      on master.business_id=b.business_id
     and master.id=b.master_inventory_item_id
    where b.shop_id=old.shop_id and b.inventory_item_id=old.id
      and (new.unit_label is distinct from master.base_unit_label or
           new.tracking_mode is distinct from master.tracking_mode)
  ) then
    raise exception using errcode='23514',
      message='catalog_inventory_master_unit_locked';
  end if;
  return new;
end;
$guard_item$;

create or replace function private.guard_bound_inventory_master_unit_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $guard_master$
begin
  if (new.base_unit_label is distinct from old.base_unit_label or
      new.tracking_mode is distinct from old.tracking_mode or
      new.business_id is distinct from old.business_id) and exists (
    select 1 from public.catalog_inventory_item_shop_bindings b
    where b.business_id=old.business_id
      and b.master_inventory_item_id=old.id
  ) then
    raise exception using errcode='23514',
      message='catalog_inventory_master_definition_locked';
  end if;
  return new;
end;
$guard_master$;

drop trigger if exists admin_catalog_inventory_binding_unit_guard
  on public.catalog_inventory_item_shop_bindings;
create trigger admin_catalog_inventory_binding_unit_guard
before insert or update on public.catalog_inventory_item_shop_bindings
for each row execute function private.guard_admin_inventory_master_binding_v1();

drop trigger if exists admin_catalog_bound_inventory_item_unit_guard
  on public.inventory_items;
create trigger admin_catalog_bound_inventory_item_unit_guard
before update of unit_label,tracking_mode on public.inventory_items
for each row execute function private.guard_bound_inventory_item_unit_v1();

drop trigger if exists admin_catalog_bound_inventory_master_unit_guard
  on public.catalog_master_inventory_items;
create trigger admin_catalog_bound_inventory_master_unit_guard
before update of base_unit_label,tracking_mode,business_id
  on public.catalog_master_inventory_items
for each row execute function private.guard_bound_inventory_master_unit_v1();

revoke all on function private.guard_admin_inventory_master_binding_v1()
  from public,anon,authenticated;
revoke all on function private.guard_bound_inventory_item_unit_v1()
  from public,anon,authenticated;
revoke all on function private.guard_bound_inventory_master_unit_v1()
  from public,anon,authenticated;
grant execute on function private.guard_admin_inventory_master_binding_v1()
  to service_role;
grant execute on function private.guard_bound_inventory_item_unit_v1()
  to service_role;
grant execute on function private.guard_bound_inventory_master_unit_v1()
  to service_role;
