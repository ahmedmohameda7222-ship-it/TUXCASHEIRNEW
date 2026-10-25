-- Inventory third-stream release gate. Apply only during serialized Catalog/Orders/
-- Inventory integration; do not apply concurrently with any other stream.
-- Off-shift means no live worker session or unfinished order, NOT a required
-- financial business-day closure. The server cannot certify unseen local
-- device outboxes: late sync must still invalidate a started count.

create or replace function private.inventory_stocktake_blocker_v1(
  p_shop_id uuid
) returns text
language plpgsql stable
set search_path = pg_catalog, public, private
as $function$
begin
  if p_shop_id is null then
    return 'concrete_shop_required';
  end if;

  if exists (
    select 1 from public.worker_sessions ws
    where ws.shop_id = p_shop_id and ws.ended_at is null
  ) then
    return 'active_worker_session';
  end if;

  if exists (
    select 1 from public.orders o
    where o.shop_id = p_shop_id
      and o.status not in ('DONE', 'CANCELLED', 'RETURNED')
  ) then
    return 'unfinished_orders';
  end if;

  return null;
end;
$function$;

revoke all on function private.inventory_stocktake_blocker_v1(uuid) from public, anon, authenticated;

create or replace function public.read_admin_stocktake_quiescence_v1(
  p_employee_id uuid,
  p_shop_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_blocker text;
begin
  perform 1 from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.stocktake'
  );

  v_blocker := private.inventory_stocktake_blocker_v1(p_shop_id);
  return jsonb_build_object(
    'allowed', v_blocker is null,
    'code', coalesce(v_blocker, 'off_shift_allowed')
  );
end;
$function$;

revoke all on function public.read_admin_stocktake_quiescence_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_stocktake_quiescence_v1(uuid, uuid)
  to service_role;

-- These triggers run INSIDE the existing authenticated stocktake RPC
-- transactions. Any violation rolls back all postings and ledger inserts.
create or replace function private.enforce_offshift_stocktake_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_blocker text;
begin
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.status = 'POSTED' and old.status <> 'POSTED') then
    v_blocker := private.inventory_stocktake_blocker_v1(new.shop_id);
    if v_blocker is not null then
      raise exception using
        errcode = 'P0001',
        message = 'stocktake_requires_off_shift',
        detail = v_blocker;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'POSTED' and old.status <> 'POSTED' then
    -- Fail closed if a receipt, order reservation, consumption, return,
    -- offline replay, transfer, adjustment or waste arrived after the DRAFT
    -- snapshot. Never silently replace a recent legitimate ledger movement.
    if exists (
      select 1
      from public.stocktake_lines l
      join public.inventory_movements m
        on m.shop_id = old.shop_id and m.inventory_item_id = l.inventory_item_id
      where l.stocktake_id = old.id
        and m.created_at > old.started_at
        and not (
          m.movement_type = 'STOCKTAKE_ADJUSTMENT'
          and m.command_id = new.post_command_id
        )
    ) or exists (
      select 1 from public.stocktake_lines l
      where l.stocktake_id = old.id
        and (
          l.posting_expected_on_hand_micros is null
          or l.posting_expected_on_hand_micros <> l.snapshot_on_hand_micros
        )
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'stocktake_snapshot_stale',
        detail = 'A stock or reservation movement occurred after the count started; reconcile and begin a new count.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_offshift_stocktake_v1() from public, anon, authenticated;

drop trigger if exists tux_inventory_stocktake_offshift_begin on public.stocktakes;
create trigger tux_inventory_stocktake_offshift_begin
  before insert on public.stocktakes
  for each row execute function private.enforce_offshift_stocktake_v1();

drop trigger if exists tux_inventory_stocktake_offshift_post on public.stocktakes;
create trigger tux_inventory_stocktake_offshift_post
  before update of status on public.stocktakes
  for each row execute function private.enforce_offshift_stocktake_v1();

comment on function public.read_admin_stocktake_quiescence_v1(uuid, uuid) is
  'Authorized off-shift stocktake eligibility. Cannot observe unsent local device outbox; posting catches recorded ledger drift.';
