-- I3 ledger safety: preserve the original audited movement path while enforcing
-- current shop/role authority BEFORE any idempotent replay and exact request
-- identity for previously committed Adjust/Waste movements. No historical
-- movement rows are rewritten. Apply only through the separately approved
-- production migration process after all tab phases and integration gates.
--
-- The advisory command lock namespace must be shared between Adjust and
-- Waste to prevent cross-type replay races for a reused command ID.
create or replace function public.post_inventory_adjustment_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_id uuid,
  p_quantity_delta_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_role text;
  v_reason_key text;
  v_reason_label text;
  v_reason_family text;
  v_reason_version bigint;
  v_on_hand bigint;
  v_reserved bigint;
  v_available bigint;
  v_new_available bigint;
  v_override_authorized boolean;
  v_movement_id uuid;
begin
  if p_employee_id is null or p_shop_id is null or p_inventory_item_id is null
     or p_quantity_delta_micros is null or p_quantity_delta_micros = 0
     or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_adjustment_command');
  end if;

  select a.business_id, a.employee_role
    into v_business_id, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.adjust'
  ) a;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-inventory-command:' || p_shop_id::text || ':' || p_command_id,
      0
    )
  );

  -- Serialize BOTH inventory admin movement types under one command namespace.
  -- Identical retries must keep every original business field, not merely the ID.
  select m.id into v_movement_id
  from public.inventory_movements m
  where m.shop_id = p_shop_id
    and m.source_kind = 'ADMIN'
    and m.command_id = p_command_id
    and m.movement_type in ('ADMIN_ADJUSTMENT', 'WASTE')
  limit 1;
  if v_movement_id is not null then
    if exists (
      select 1 from public.inventory_movements m
      where m.id = v_movement_id
        and m.movement_type = 'ADMIN_ADJUSTMENT'
        and m.inventory_item_id = p_inventory_item_id
        and m.quantity_delta_micros = p_quantity_delta_micros
        and m.admin_employee_id = p_employee_id
        and m.reason_code_id = p_reason_code_id
        and coalesce(m.note, '') = btrim(coalesce(p_note, ''))
        and m.emergency_negative_override = coalesce(p_emergency_negative_override, false)
    ) then
      return jsonb_build_object(
        'ok', true, 'idempotentReplay', true, 'movementId', v_movement_id
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  perform private.assert_inventory_item_shop_v1(p_shop_id, p_inventory_item_id);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || p_shop_id::text || ':' || p_inventory_item_id::text,
      0
    )
  );

  select r.reason_code_key, r.reason_label, r.reason_family, r.reason_version
    into v_reason_key, v_reason_label, v_reason_family, v_reason_version
  from private.inventory_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'STOCK_ADJUSTMENT'
  ) r;

  select b.on_hand_micros, b.reserved_micros, b.available_micros
    into v_on_hand, v_reserved, v_available
  from private.inventory_balance_v1(p_shop_id, p_inventory_item_id) b;

  v_new_available := v_on_hand + p_quantity_delta_micros - v_reserved;
  if v_new_available < 0 then
    if not coalesce(p_emergency_negative_override, false) then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'availableMicros', v_available
      );
    end if;

    if v_role <> 'OWNER' or p_note is null or btrim(p_note) = '' then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;

    select a.authorized into v_override_authorized
    from public.resolve_admin_authorization_v1(
      p_employee_id, p_shop_id, 'inventory.override_negative'
    ) a
    limit 1;
    if not coalesce(v_override_authorized, false) then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;
  end if;

  v_movement_id := gen_random_uuid();
  insert into public.inventory_movements(
    id,
    shop_id,
    business_day_id,
    inventory_item_id,
    movement_type,
    quantity_delta_micros,
    reserved_delta_micros,
    worker_id,
    order_id,
    compensates_movement_id,
    idempotency_key,
    admin_employee_id,
    source_kind,
    command_id,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    emergency_negative_override,
    created_at
  ) values (
    v_movement_id,
    p_shop_id,
    null,
    p_inventory_item_id,
    'ADMIN_ADJUSTMENT',
    p_quantity_delta_micros,
    0,
    null,
    null,
    null,
    'admin-adjustment:' || p_command_id,
    p_employee_id,
    'ADMIN',
    p_command_id,
    p_reason_code_id,
    v_reason_key,
    v_reason_label,
    v_reason_family,
    v_reason_version,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_emergency_negative_override, false),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'movementId', v_movement_id,
    'onHandMicros', v_on_hand + p_quantity_delta_micros,
    'reservedMicros', v_reserved,
    'availableMicros', v_new_available
  );
end;
$$;

create or replace function public.post_inventory_waste_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_id uuid,
  p_quantity_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $waste$
declare
  v_business_id uuid;
  v_role text;
  v_reason_key text;
  v_reason_label text;
  v_reason_family text;
  v_reason_version bigint;
  v_on_hand bigint;
  v_reserved bigint;
  v_available bigint;
  v_new_available bigint;
  v_override_authorized boolean;
  v_unit_cost numeric(20, 6);
  v_movement_id uuid;
begin
  if p_employee_id is null or p_shop_id is null or p_inventory_item_id is null
     or p_quantity_micros is null or p_quantity_micros <= 0
     or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_waste_command');
  end if;

  select a.business_id, a.employee_role
    into v_business_id, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.adjust'
  ) a;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-inventory-command:' || p_shop_id::text || ':' || p_command_id,
      0
    )
  );

  -- Serialize BOTH inventory admin movement types under one command namespace.
  -- Identical retries must keep every original business field, not merely the ID.
  select m.id into v_movement_id
  from public.inventory_movements m
  where m.shop_id = p_shop_id
    and m.source_kind = 'ADMIN'
    and m.command_id = p_command_id
    and m.movement_type in ('ADMIN_ADJUSTMENT', 'WASTE')
  limit 1;
  if v_movement_id is not null then
    if exists (
      select 1 from public.inventory_movements m
      where m.id = v_movement_id
        and m.movement_type = 'WASTE'
        and m.inventory_item_id = p_inventory_item_id
        and m.quantity_delta_micros = -p_quantity_micros
        and m.admin_employee_id = p_employee_id
        and m.reason_code_id = p_reason_code_id
        and coalesce(m.note, '') = btrim(coalesce(p_note, ''))
        and m.emergency_negative_override = coalesce(p_emergency_negative_override, false)
    ) then
      return jsonb_build_object(
        'ok', true, 'idempotentReplay', true, 'movementId', v_movement_id
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  perform private.assert_inventory_item_shop_v1(p_shop_id, p_inventory_item_id);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || p_shop_id::text || ':' || p_inventory_item_id::text,
      0
    )
  );

  select r.reason_code_key, r.reason_label, r.reason_family, r.reason_version
    into v_reason_key, v_reason_label, v_reason_family, v_reason_version
  from private.inventory_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'WASTE'
  ) r;

  select b.on_hand_micros, b.reserved_micros, b.available_micros
    into v_on_hand, v_reserved, v_available
  from private.inventory_balance_v1(p_shop_id, p_inventory_item_id) b;

  v_new_available := v_on_hand - p_quantity_micros - v_reserved;
  if v_new_available < 0 then
    if not coalesce(p_emergency_negative_override, false) then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'availableMicros', v_available
      );
    end if;

    if v_role <> 'OWNER' or p_note is null or btrim(p_note) = '' then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;

    select a.authorized into v_override_authorized
    from public.resolve_admin_authorization_v1(
      p_employee_id, p_shop_id, 'inventory.override_negative'
    ) a
    limit 1;
    if not coalesce(v_override_authorized, false) then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;
  end if;

  select coalesce(c.weighted_unit_cost_minor, 0)
    into v_unit_cost
  from public.inventory_cost_state c
  where c.shop_id = p_shop_id
    and c.inventory_item_id = p_inventory_item_id;
  v_unit_cost := coalesce(v_unit_cost, 0);

  v_movement_id := gen_random_uuid();
  insert into public.inventory_movements(
    id,
    shop_id,
    business_day_id,
    inventory_item_id,
    movement_type,
    quantity_delta_micros,
    reserved_delta_micros,
    worker_id,
    order_id,
    compensates_movement_id,
    idempotency_key,
    admin_employee_id,
    source_kind,
    command_id,
    unit_cost_minor,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    emergency_negative_override,
    created_at
  ) values (
    v_movement_id,
    p_shop_id,
    null,
    p_inventory_item_id,
    'WASTE',
    -p_quantity_micros,
    0,
    null,
    null,
    null,
    'inventory-waste:' || p_command_id,
    p_employee_id,
    'ADMIN',
    p_command_id,
    v_unit_cost,
    p_reason_code_id,
    v_reason_key,
    v_reason_label,
    v_reason_family,
    v_reason_version,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_emergency_negative_override, false),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'movementId', v_movement_id,
    'onHandMicros', v_on_hand - p_quantity_micros,
    'reservedMicros', v_reserved,
    'availableMicros', v_new_available
  );
end;
$waste$;

