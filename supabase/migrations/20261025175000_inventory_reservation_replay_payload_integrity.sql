-- Approved Inventory financial safety: reservation retry commands must be
-- immutable across delayed / reordered POS or Online delivery.
-- Source: unchanged production reserve_inventory_for_order_v1 baseline with ONLY
-- the replay line/payload identity guard strengthened. Full PG CI required.
-- Serial application ONLY after Catalog #157 / Orders #158 release review;
-- do NOT apply this migration directly to Production from Inventory branch.
CREATE OR REPLACE FUNCTION public.reserve_inventory_for_order_v1(p_shop_id uuid, p_order_id uuid, p_business_day_id uuid, p_worker_id uuid, p_requirements jsonb, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_line jsonb;
  v_item_id uuid;
  v_quantity bigint;
  v_available bigint;
  v_existing integer;
begin
  if p_shop_id is null
     or p_order_id is null
     or p_worker_id is null
     or p_requirements is null
     or jsonb_typeof(p_requirements) <> 'array'
     or jsonb_array_length(p_requirements) = 0
     or p_command_id is null
     or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_reservation_command');
  end if;

  if not exists (
    select 1 from public.workers w
    where w.id = p_worker_id and w.shop_id = p_shop_id and w.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;
  if not exists (
    select 1 from public.orders o where o.id = p_order_id and o.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if p_business_day_id is not null and not exists (
    select 1 from public.business_days d
    where d.id = p_business_day_id and d.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'business_day_not_found');
  end if;

  select count(*) into v_existing
  from public.inventory_reservations r
  where r.shop_id = p_shop_id
    and r.order_id = p_order_id
    and r.reserve_command_id = p_command_id;
  -- An ambiguous network retry must replay the IDENTICAL canonical order
  -- reservation intent, never merely the same number of recipe ingredients.
  -- The stored reservation line set is immutable after its original command;
  -- reservation.status may have advanced to CONSUMED/RELEASED legitimately.
  if v_existing > 0 then
    if v_existing <> jsonb_array_length(p_requirements)
       or exists (
         select 1 from public.inventory_reservations r
         where r.shop_id = p_shop_id and r.order_id = p_order_id
           and r.reserve_command_id = p_command_id
           and (
             r.business_day_id is distinct from p_business_day_id
             or r.created_by_worker_id is distinct from p_worker_id
             or not exists (
               select 1 from jsonb_array_elements(p_requirements) req
               where req.value ->> 'inventoryItemId' = r.inventory_item_id::text
                 and req.value ->> 'quantityMicros' = r.quantity_micros::text
             )
           )
       )
       or exists (
         select 1 from jsonb_array_elements(p_requirements) req
         where not exists (
           select 1 from public.inventory_reservations r
           where r.shop_id = p_shop_id and r.order_id = p_order_id
             and r.reserve_command_id = p_command_id
             and req.value ->> 'inventoryItemId' = r.inventory_item_id::text
             and req.value ->> 'quantityMicros' = r.quantity_micros::text
         )
       ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  for v_line in
    select value
    from jsonb_array_elements(p_requirements)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_quantity := (v_line ->> 'quantityMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_reservation_line');
    end;
    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_reservation_line');
    end if;

    perform private.assert_inventory_item_shop_v1(p_shop_id, v_item_id);
    perform pg_advisory_xact_lock(
      hashtextextended('tux-inventory:' || p_shop_id::text || ':' || v_item_id::text, 0)
    );

    if exists (
      select 1 from public.inventory_reservations r
      where r.shop_id = p_shop_id
        and r.order_id = p_order_id
        and r.inventory_item_id = v_item_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'reservation_conflict');
    end if;

    select b.available_micros into v_available
    from private.inventory_balance_v1(p_shop_id, v_item_id) b;

    if v_available < v_quantity then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'inventoryItemId', v_item_id,
        'availableMicros', v_available
      );
    end if;
  end loop;

  for v_line in
    select value
    from jsonb_array_elements(p_requirements)
    order by value ->> 'inventoryItemId'
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_quantity := (v_line ->> 'quantityMicros')::bigint;

    insert into public.inventory_reservations(
      shop_id,
      business_day_id,
      order_id,
      inventory_item_id,
      quantity_micros,
      status,
      reserve_command_id,
      last_command_id,
      created_by_worker_id
    ) values (
      p_shop_id,
      p_business_day_id,
      p_order_id,
      v_item_id,
      v_quantity,
      'ACTIVE',
      p_command_id,
      p_command_id,
      p_worker_id
    );

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
      source_kind,
      command_id,
      created_at
    ) values (
      gen_random_uuid(),
      p_shop_id,
      p_business_day_id,
      v_item_id,
      'ORDER_RESERVATION',
      0,
      v_quantity,
      p_worker_id,
      p_order_id,
      null,
      'order-reservation:' || p_command_id || ':' || v_item_id::text,
      'OPERATIONS',
      p_command_id,
      now()
    );
  end loop;

  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$function$;

revoke all on function public.reserve_inventory_for_order_v1(
  uuid,uuid,uuid,uuid,jsonb,text
) from public,anon,authenticated;
grant execute on function public.reserve_inventory_for_order_v1(
  uuid,uuid,uuid,uuid,jsonb,text
) to service_role;
