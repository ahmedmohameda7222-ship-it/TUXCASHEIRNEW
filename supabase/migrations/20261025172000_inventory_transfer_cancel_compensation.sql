-- Inventory branch: allow cancellation only while a transfer remains SENT.
-- A cancelled transfer restores the source by a distinct compensating ledger
-- movement; RECEIVE and CANCEL compete on the same FOR UPDATE row lock.
-- Apply only during serial three-stream migration integration.

alter table public.stock_transfers
  add column if not exists cancel_command_id text;
alter table public.stock_transfers
  add column if not exists cancelled_at timestamptz;
alter table public.stock_transfers
  add column if not exists cancelled_by_employee_id uuid references public.business_employees(id);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in (
    'ORDER_CONSUMPTION',
    'CANCEL_RESTOCK',
    'BULK_UNIT_FINISHED',
    'BULK_STOCK_RECEIVED',
    'UNDO_BULK_UNIT_FINISHED',
    'UNDO_BULK_STOCK_RECEIVED',
    'ADMIN_ADJUSTMENT',
    'ORDER_RESERVATION',
    'ORDER_RESERVATION_RELEASE',
    'ORDER_CONSUMPTION_REVERSAL',
    'WASTE',
    'STOCKTAKE_ADJUSTMENT',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'TRANSFER_CANCELLED',
    'PURCHASE_RECEIPT',
    'PURCHASE_RETURN'
  ));

create or replace function public.cancel_stock_transfer_v1(
  p_employee_id uuid,
  p_transfer_id uuid,
  p_command_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line public.stock_transfer_lines%rowtype;
  v_out_movement_id uuid;
begin
  if p_employee_id is null or p_transfer_id is null or
     p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_transfer_cancel_command');
  end if;

  -- Shared lock is identical to RECEIVE's first lock; only one may win.
  select t.* into v_transfer
  from public.stock_transfers t
  where t.id = p_transfer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'transfer_not_found');
  end if;

  perform 1 from private.admin_inventory_authority_v1(
    p_employee_id, v_transfer.source_shop_id, 'inventory.transfer'
  );

  if v_transfer.status = 'CANCELLED' then
    if v_transfer.cancel_command_id = p_command_id then
      return jsonb_build_object('ok', true, 'idempotentReplay', true,
        'transferId', v_transfer.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if v_transfer.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'transfer_not_cancellable');
  end if;

  -- Source item locks serialize with new adjustments and transfer sends.
  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_transfer.id
    order by inventory_item_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || v_transfer.source_shop_id::text || ':' ||
        v_line.inventory_item_id::text, 0
      )
    );
  end loop;

  for v_line in
    select * from public.stock_transfer_lines
    where transfer_id = v_transfer.id
    order by inventory_item_id
  loop
    -- Require an exact immutable original deduction to compensate.
    select m.id into v_out_movement_id
    from public.inventory_movements m
    where m.shop_id = v_transfer.source_shop_id
      and m.inventory_item_id = v_line.inventory_item_id
      and m.movement_type = 'TRANSFER_OUT'
      and m.idempotency_key =
        'transfer-out:' || v_transfer.send_command_id || ':' ||
        v_line.inventory_item_id::text
      and m.quantity_delta_micros = -v_line.quantity_micros;

    if v_out_movement_id is null then
      return jsonb_build_object('ok', false, 'code', 'transfer_out_ledger_missing');
    end if;

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), v_transfer.source_shop_id, null,
      v_line.inventory_item_id, 'TRANSFER_CANCELLED',
      v_line.quantity_micros, 0, null, null, v_out_movement_id,
      'transfer-cancel:' || v_transfer.id::text || ':' ||
      v_line.inventory_item_id::text,
      p_employee_id, 'ADMIN', p_command_id,
      v_line.source_unit_cost_minor, now()
    );
  end loop;

  update public.stock_transfers
  set status = 'CANCELLED',
      cancel_command_id = p_command_id,
      cancelled_by_employee_id = p_employee_id,
      cancelled_at = now(),
      updated_at = now()
  where id = v_transfer.id;

  return jsonb_build_object(
    'ok', true, 'idempotentReplay', false, 'transferId', v_transfer.id
  );
end;
$function$;

revoke all on function public.cancel_stock_transfer_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_stock_transfer_v1(uuid, uuid, text)
  to service_role;
