-- Inventory independent stream. Do not apply in parallel with Catalog #157 or
-- Orders #158. Replaces ONLY the original transfer send RPC body, preserving
-- signature, employee authority checks, source ledger debit, and idempotent
-- successful returns. Origin: exact canonical production function definition.
-- Definer grants remain unchanged by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.send_stock_transfer_v1(p_employee_id uuid, p_source_shop_id uuid, p_destination_shop_id uuid, p_lines jsonb, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_source_business uuid;
  v_destination_business uuid;
  v_role text;
  v_transfer_id uuid;
  v_existing_transfer public.stock_transfers%rowtype;
  v_existing_payload jsonb;
  v_requested_payload jsonb;
  v_mapping_count bigint;
  v_line jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_destination_item_id uuid;
  v_quantity bigint;
  v_available bigint;
  v_unit_cost numeric(20, 6);
begin
  if p_employee_id is null or p_source_shop_id is null or p_destination_shop_id is null
     or p_source_shop_id = p_destination_shop_id
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 500
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_transfer_command');
  end if;

  select a.business_id, a.employee_role into v_source_business, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_source_shop_id, 'inventory.transfer'
  ) a;
  select a.business_id into v_destination_business
  from private.admin_inventory_authority_v1(
    p_employee_id, p_destination_shop_id, 'inventory.transfer'
  ) a;

  if v_source_business is distinct from v_destination_business then
    return jsonb_build_object('ok', false, 'code', 'cross_business_transfer_forbidden');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-stock-transfer-send-command:' || p_source_shop_id::text || ':' || p_command_id,
      0
    )
  );

  select t.* into v_existing_transfer
  from public.stock_transfers t
  where t.source_shop_id = p_source_shop_id and t.send_command_id = p_command_id;
  if found then
    if v_existing_transfer.destination_shop_id is distinct from p_destination_shop_id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    -- Existing command replay must carry identical product IDs and quantities.
    select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', l.inventory_item_id::text,
      'quantityMicros', l.quantity_micros::text
    ) order by l.inventory_item_id), '[]'::jsonb)
      into v_existing_payload
    from public.stock_transfer_lines l
    where l.transfer_id = v_existing_transfer.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'inventoryItemId', value ->> 'inventoryItemId',
      'quantityMicros', value ->> 'quantityMicros'
    ) order by value ->> 'inventoryItemId'), '[]'::jsonb)
      into v_requested_payload
    from jsonb_array_elements(p_lines);
    if v_existing_payload is distinct from v_requested_payload then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;

    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true, 'transferId', v_existing_transfer.id
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    group by line.value ->> 'inventoryItemId'
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_transfer_item');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_quantity := (v_line ->> 'quantityMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_transfer_line');
    end;
    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_transfer_line');
    end if;
    perform private.assert_inventory_item_shop_v1(p_source_shop_id, v_item_id);
    -- Master IDs are the business-wide canonical identity. Never equate
    -- similarly named products across shops; never silently choose the first.
    select count(*), min(destination_item.id)
      into v_mapping_count, v_destination_item_id
    from public.catalog_inventory_item_shop_bindings source_binding
    join public.catalog_inventory_item_shop_bindings destination_binding
      on destination_binding.business_id = source_binding.business_id
      and destination_binding.master_inventory_item_id = source_binding.master_inventory_item_id
      and destination_binding.shop_id = p_destination_shop_id
    join public.catalog_master_inventory_items master_item
      on master_item.id = source_binding.master_inventory_item_id
      and master_item.business_id = source_binding.business_id
    join public.inventory_items source_item
      on source_item.id = source_binding.inventory_item_id
      and source_item.shop_id = source_binding.shop_id
    join public.inventory_items destination_item
      on destination_item.id = destination_binding.inventory_item_id
      and destination_item.shop_id = p_destination_shop_id
    where source_binding.business_id = v_source_business
      and source_binding.shop_id = p_source_shop_id
      and source_binding.inventory_item_id = v_item_id
      and source_item.active
      and destination_item.active
      and source_item.unit_label = master_item.base_unit_label
      and destination_item.unit_label = master_item.base_unit_label
      and source_item.tracking_mode = master_item.tracking_mode
      and destination_item.tracking_mode = master_item.tracking_mode;

    if v_mapping_count <> 1 or v_destination_item_id is null then
      return jsonb_build_object(
        'ok', false, 'code', 'destination_inventory_master_mapping_required',
        'inventoryItemId', v_item_id
      );
    end if;

    v_resolved_lines := v_resolved_lines || jsonb_build_array(
      v_line || jsonb_build_object('destinationInventoryItemId', v_destination_item_id)
    );

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_source_shop_id::text || ':' || v_item_id::text,
        0
      )
    );
    select b.available_micros into v_available
    from private.inventory_balance_v1(p_source_shop_id, v_item_id) b;
    if v_available < v_quantity then
      return jsonb_build_object(
        'ok', false, 'code', 'insufficient_stock',
        'inventoryItemId', v_item_id, 'availableMicros', v_available
      );
    end if;
  end loop;

  v_transfer_id := gen_random_uuid();
  insert into public.stock_transfers(
    id, source_shop_id, destination_shop_id, created_by_employee_id,
    status, send_command_id
  ) values (
    v_transfer_id, p_source_shop_id, p_destination_shop_id, p_employee_id,
    'SENT', p_command_id
  );

  for v_line in
    select value from jsonb_array_elements(v_resolved_lines)
    order by value ->> 'inventoryItemId'
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_destination_item_id := (v_line ->> 'destinationInventoryItemId')::uuid;
    v_quantity := (v_line ->> 'quantityMicros')::bigint;
    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_unit_cost
    from public.inventory_cost_state c
    where c.shop_id = p_source_shop_id and c.inventory_item_id = v_item_id;
    v_unit_cost := coalesce(v_unit_cost, 0);

    insert into public.stock_transfer_lines(
      transfer_id, inventory_item_id, destination_inventory_item_id,
      quantity_micros, source_unit_cost_minor
    ) values (
      v_transfer_id, v_item_id, v_destination_item_id,
      v_quantity, v_unit_cost
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_source_shop_id, null, v_item_id, 'TRANSFER_OUT',
      -v_quantity, 0, null, null, null,
      'transfer-out:' || p_command_id || ':' || v_item_id::text,
      p_employee_id, 'ADMIN', p_command_id, v_unit_cost, now()
    );
  end loop;

  return jsonb_build_object(
    'ok', true, 'idempotentReplay', false, 'transferId', v_transfer_id
  );
end;
$function$;

-- Preserve and explicitly reassert the original trusted BFF-only execution boundary.
revoke all on function public.send_stock_transfer_v1(uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.send_stock_transfer_v1(uuid, uuid, uuid, jsonb, text)
  to service_role;
