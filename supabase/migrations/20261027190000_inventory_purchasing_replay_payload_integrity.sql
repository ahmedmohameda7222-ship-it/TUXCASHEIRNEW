-- I3 Purchasing-to-Inventory shared ledger contract.
-- A retry with an existing command ID is idempotent ONLY for the exact original
-- normalized request. Preserve all historical receipt/return/movement rows.
-- The original Purchasing RPC business logic is otherwise unchanged.
-- PRE-MERGE SOURCE ONLY: never apply to production without owner's release gate.

create or replace function public.receive_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_command_id text,
  p_supplier_reference text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
  v_existing_receipt uuid;
  v_existing_receipt_purchase_order_id uuid;
  v_receipt_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_inventory_item_id uuid;
  v_received_purchase bigint;
  v_received_base_numeric numeric;
  v_received bigint;
  v_purchase_cost numeric(20, 6);
  v_unit_cost numeric(20, 6);
  v_po_line public.purchase_order_lines%rowtype;
  v_on_hand bigint;
  v_current_cost numeric(20, 6);
  v_new_cost numeric(20, 6);
  v_complete boolean;
  v_new_status text;
  v_new_version bigint;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.receive'
  );
  if nullif(btrim(coalesce(p_command_id, '')), '') is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_receive_command');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    group by line.value ->> 'lineId'
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_purchase_order_line');
  end if;

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found or v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;

  select r.id, r.purchase_order_id
    into v_existing_receipt, v_existing_receipt_purchase_order_id
  from public.purchase_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id;
  if v_existing_receipt is not null then
    if v_existing_receipt_purchase_order_id is distinct from v_order.id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;

    -- Replay means the SAME authorized actor, normalized supplier reference,
    -- exact PO lines, purchase quantities and costs; a reused ID is not enough.
    if exists (
      select 1 from public.purchase_receipts r
      where r.id = v_existing_receipt
        and (r.received_by_employee_id is distinct from p_employee_id
          or r.supplier_reference is distinct from nullif(btrim(coalesce(p_supplier_reference,'')), ''))
    ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lineId', rl.purchase_order_line_id::text,
        'receivedPurchaseUnitsMicros', rl.received_purchase_units_micros,
        'purchaseUnitCostMinor', rl.purchase_unit_cost_minor
      ) order by rl.purchase_order_line_id), '[]'::jsonb)
      from public.purchase_receipt_lines rl
      where rl.purchase_receipt_id = v_existing_receipt
    ) is distinct from (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lineId', (line.value ->> 'lineId')::uuid::text,
        'receivedPurchaseUnitsMicros', (line.value ->> 'receivedPurchaseUnitsMicros')::bigint,
        'purchaseUnitCostMinor', (line.value ->> 'purchaseUnitCostMinor')::numeric
      ) order by (line.value ->> 'lineId')::uuid), '[]'::jsonb)
      from jsonb_array_elements(p_lines) line(value)
    ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'receiptId', v_existing_receipt, 'status', v_order.status,
      'version', v_order.version, 'idempotentReplay', true
    );
  end if;
  if v_order.status not in ('ORDERED', 'PARTIALLY_RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_receivable');
  end if;

  for v_inventory_item_id in
    select distinct pol.inventory_item_id
    from jsonb_array_elements(p_lines) line(value)
    join public.purchase_order_lines pol
      on pol.purchase_order_id = v_order.id
     and pol.id::text = line.value ->> 'lineId'
    order by pol.inventory_item_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_inventory_item_id::text, 0
      )
    );
  end loop;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    begin
      v_line_id := (v_line ->> 'lineId')::uuid;
      v_received_purchase := (v_line ->> 'receivedPurchaseUnitsMicros')::bigint;
      v_purchase_cost := (v_line ->> 'purchaseUnitCostMinor')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_receive_line');
    end;
    if v_received_purchase <= 0 or v_purchase_cost < 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_receive_line');
    end if;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'purchase_order_line_not_found');
    end if;

    v_received_base_numeric :=
      (v_received_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
      / 1000000::numeric;
    if v_received_base_numeric <= 0
       or v_received_base_numeric <> trunc(v_received_base_numeric) then
      return jsonb_build_object('ok', false, 'code', 'purchase_unit_conversion_inexact');
    end if;
    v_received := v_received_base_numeric::bigint;

    if v_received_purchase >
       v_po_line.ordered_purchase_units_micros - v_po_line.received_purchase_units_micros
       or v_received > v_po_line.ordered_base_micros - v_po_line.received_base_micros then
      return jsonb_build_object(
        'ok', false, 'code', 'receive_exceeds_remaining',
        'lineId', v_po_line.id,
        'remainingBaseMicros', v_po_line.ordered_base_micros - v_po_line.received_base_micros
      );
    end if;
  end loop;

  v_receipt_id := gen_random_uuid();
  insert into public.purchase_receipts(
    id, purchase_order_id, shop_id, supplier_id, supplier_reference,
    command_id, received_by_employee_id
  ) values (
    v_receipt_id, v_order.id, p_shop_id, v_order.supplier_id,
    nullif(btrim(coalesce(p_supplier_reference, '')), ''),
    p_command_id, p_employee_id
  );

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    v_line_id := (v_line ->> 'lineId')::uuid;
    v_received_purchase := (v_line ->> 'receivedPurchaseUnitsMicros')::bigint;
    v_purchase_cost := (v_line ->> 'purchaseUnitCostMinor')::numeric;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;

    v_received :=
      ((v_received_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
       / 1000000::numeric)::bigint;
    v_unit_cost :=
      (v_purchase_cost * 1000000::numeric) / v_po_line.base_micros_per_purchase_unit::numeric;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_po_line.inventory_item_id::text, 0
      )
    );

    select b.on_hand_micros into v_on_hand
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;

    select c.weighted_unit_cost_minor into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    if v_on_hand <= 0 then
      v_new_cost := v_unit_cost;
    else
      v_new_cost := (
        (v_on_hand::numeric * v_current_cost)
        + (v_received::numeric * v_unit_cost)
      ) / (v_on_hand + v_received)::numeric;
    end if;

    insert into public.purchase_receipt_lines(
      purchase_receipt_id, purchase_order_line_id, inventory_item_id,
      received_purchase_units_micros, received_base_micros,
      purchase_unit_cost_minor, unit_cost_minor
    ) values (
      v_receipt_id, v_po_line.id, v_po_line.inventory_item_id,
      v_received_purchase, v_received, v_purchase_cost, v_unit_cost
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_shop_id, null, v_po_line.inventory_item_id, 'PURCHASE_RECEIPT',
      v_received, 0, null, null, null,
      'purchase-receipt:' || p_command_id || ':' || v_po_line.id::text,
      p_employee_id, 'ADMIN', p_command_id, v_unit_cost, now()
    );

    insert into public.inventory_cost_state(
      shop_id, inventory_item_id, weighted_unit_cost_minor, version
    ) values (
      p_shop_id, v_po_line.inventory_item_id, v_new_cost, 1
    )
    on conflict (shop_id, inventory_item_id) do update
    set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
        version = public.inventory_cost_state.version + 1,
        updated_at = now();

    update public.purchase_order_lines
    set received_purchase_units_micros =
          received_purchase_units_micros + v_received_purchase,
        received_base_micros = received_base_micros + v_received,
        updated_at = now()
    where id = v_po_line.id;

    insert into public.supplier_inventory_items(
      supplier_id, inventory_item_id, purchase_unit_label,
      base_micros_per_purchase_unit, last_unit_cost_minor
    ) values (
      v_order.supplier_id, v_po_line.inventory_item_id, v_po_line.purchase_unit_label,
      v_po_line.base_micros_per_purchase_unit, v_purchase_cost
    )
    on conflict (supplier_id, inventory_item_id) do update
    set purchase_unit_label = excluded.purchase_unit_label,
        base_micros_per_purchase_unit = excluded.base_micros_per_purchase_unit,
        last_unit_cost_minor = excluded.last_unit_cost_minor,
        active = true,
        updated_at = now();

    insert into public.supplier_price_history(
      supplier_id, inventory_item_id, purchase_order_id, purchase_receipt_id,
      source_kind, purchase_unit_label, base_micros_per_purchase_unit,
      purchase_unit_cost_minor, unit_cost_minor
    ) values (
      v_order.supplier_id, v_po_line.inventory_item_id, v_order.id, v_receipt_id,
      'RECEIPT', v_po_line.purchase_unit_label, v_po_line.base_micros_per_purchase_unit,
      v_purchase_cost, v_unit_cost
    );
  end loop;

  select not exists (
    select 1
    from public.purchase_order_lines pol
    where pol.purchase_order_id = v_order.id
      and pol.received_base_micros < pol.ordered_base_micros
  ) into v_complete;

  v_new_status := case when v_complete then 'RECEIVED' else 'PARTIALLY_RECEIVED' end;
  v_new_version := v_order.version + 1;

  update public.purchase_orders
  set status = v_new_status,
      version = v_new_version,
      updated_at = now()
  where id = v_order.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_RECEIVED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object(
      'status', v_new_status, 'version', v_new_version,
      'receiptId', v_receipt_id,
      'supplierReference', nullif(btrim(coalesce(p_supplier_reference, '')), '')
    ),
    null, null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_order.id, 'receiptId', v_receipt_id,
    'status', v_new_status, 'version', v_new_version, 'idempotentReplay', false
  );
end;
$$;

create or replace function public.return_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_command_id text,
  p_supplier_reference text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
  v_existing_return uuid;
  v_existing_return_purchase_order_id uuid;
  v_return_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_inventory_item_id uuid;
  v_returned_purchase bigint;
  v_returned_base_numeric numeric;
  v_returned bigint;
  v_po_line public.purchase_order_lines%rowtype;
  v_available bigint;
  v_on_hand bigint;
  v_current_cost numeric(20, 6);
  v_current_value numeric;
  v_return_value numeric;
  v_inventory_value_removed numeric;
  v_line_purchase_price_variance numeric(20, 6);
  v_total_purchase_price_variance numeric(20, 6) := 0;
  v_weighted_return_cost numeric(20, 6);
  v_new_on_hand bigint;
  v_new_value numeric;
  v_new_cost numeric(20, 6);
  v_receipt_line record;
  v_receipt_available bigint;
  v_alloc bigint;
  v_alloc_purchase numeric;
  v_remaining bigint;
  v_new_version bigint;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.receive'
  );
  if nullif(btrim(coalesce(p_command_id, '')), '') is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_return_command');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    group by line.value ->> 'lineId'
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_purchase_order_line');
  end if;

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found or v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;

  select r.id, r.purchase_order_id
    into v_existing_return, v_existing_return_purchase_order_id
  from public.purchase_returns r
  where r.shop_id = p_shop_id and r.command_id = p_command_id;
  if v_existing_return is not null then
    if v_existing_return_purchase_order_id is distinct from v_order.id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;

    -- A return may allocate across multiple historical receipt lines. Match
    -- the aggregated posted purchase quantity per PO line, never just the ID.
    if exists (
      select 1 from public.purchase_returns r
      where r.id = v_existing_return
        and (r.returned_by_employee_id is distinct from p_employee_id
          or r.supplier_reference is distinct from nullif(btrim(coalesce(p_supplier_reference,'')), ''))
    ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    if (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lineId', posted.purchase_order_line_id::text,
        'returnedPurchaseUnitsMicros', posted.units
      ) order by posted.purchase_order_line_id), '[]'::jsonb)
      from (
        select prl.purchase_order_line_id,
               sum(prl.returned_purchase_units_micros)::bigint as units
        from public.purchase_return_lines prl
        where prl.purchase_return_id = v_existing_return
        group by prl.purchase_order_line_id
      ) posted
    ) is distinct from (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lineId', (line.value ->> 'lineId')::uuid::text,
        'returnedPurchaseUnitsMicros', (line.value ->> 'returnedPurchaseUnitsMicros')::bigint
      ) order by (line.value ->> 'lineId')::uuid), '[]'::jsonb)
      from jsonb_array_elements(p_lines) line(value)
    ) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'returnId', v_existing_return, 'status', v_order.status,
      'version', v_order.version, 'idempotentReplay', true
    );
  end if;
  if v_order.status not in ('PARTIALLY_RECEIVED', 'RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_returnable');
  end if;

  for v_inventory_item_id in
    select distinct pol.inventory_item_id
    from jsonb_array_elements(p_lines) line(value)
    join public.purchase_order_lines pol
      on pol.purchase_order_id = v_order.id
     and pol.id::text = line.value ->> 'lineId'
    order by pol.inventory_item_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_inventory_item_id::text, 0
      )
    );
  end loop;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    begin
      v_line_id := (v_line ->> 'lineId')::uuid;
      v_returned_purchase := (v_line ->> 'returnedPurchaseUnitsMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_line');
    end;
    if v_returned_purchase <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_line');
    end if;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'purchase_order_line_not_found');
    end if;

    v_returned_base_numeric :=
      (v_returned_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
      / 1000000::numeric;
    if v_returned_base_numeric <= 0
       or v_returned_base_numeric <> trunc(v_returned_base_numeric) then
      return jsonb_build_object('ok', false, 'code', 'purchase_unit_conversion_inexact');
    end if;
    v_returned := v_returned_base_numeric::bigint;

    if v_returned_purchase >
       v_po_line.received_purchase_units_micros - v_po_line.returned_purchase_units_micros
       or v_returned > v_po_line.received_base_micros - v_po_line.returned_base_micros then
      return jsonb_build_object(
        'ok', false, 'code', 'return_exceeds_received',
        'lineId', v_po_line.id,
        'returnableBaseMicros', v_po_line.received_base_micros - v_po_line.returned_base_micros
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_po_line.inventory_item_id::text, 0
      )
    );

    select b.on_hand_micros, b.available_micros
      into v_on_hand, v_available
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;
    if v_available < v_returned then
      return jsonb_build_object(
        'ok', false, 'code', 'insufficient_stock',
        'lineId', v_po_line.id, 'remainingBaseMicros', v_available
      );
    end if;

    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    select coalesce(sum(
      greatest(
        0::numeric,
        least(
          x.receipt_available::numeric,
          v_returned::numeric - x.before_available
        )
      ) * x.unit_cost_minor
    ), 0)
    into v_return_value
    from (
      select
        q.*,
        coalesce(
          sum(q.receipt_available) over (
            order by q.received_at desc, q.receipt_line_id desc
            rows between unbounded preceding and 1 preceding
          ),
          0
        )::numeric as before_available
      from (
        select
          rl.id as receipt_line_id,
          r.received_at,
          rl.unit_cost_minor,
          greatest(
            0,
            rl.received_base_micros
            - coalesce((
              select sum(prl.returned_base_micros)
              from public.purchase_return_lines prl
              where prl.purchase_receipt_line_id = rl.id
            ), 0)
          )::bigint as receipt_available
        from public.purchase_receipt_lines rl
        join public.purchase_receipts r on r.id = rl.purchase_receipt_id
        where rl.purchase_order_line_id = v_po_line.id
      ) q
    ) x;

  end loop;

  v_return_id := gen_random_uuid();
  insert into public.purchase_returns(
    id, purchase_order_id, shop_id, supplier_id, supplier_reference,
    command_id, returned_by_employee_id
  ) values (
    v_return_id, v_order.id, p_shop_id, v_order.supplier_id,
    nullif(btrim(coalesce(p_supplier_reference, '')), ''),
    p_command_id, p_employee_id
  );

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    v_line_id := (v_line ->> 'lineId')::uuid;
    v_returned_purchase := (v_line ->> 'returnedPurchaseUnitsMicros')::bigint;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;

    v_returned :=
      ((v_returned_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
       / 1000000::numeric)::bigint;

    select b.on_hand_micros into v_on_hand
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;
    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    v_remaining := v_returned;
    v_return_value := 0;

    for v_receipt_line in
      select
        rl.id,
        rl.received_base_micros,
        rl.purchase_unit_cost_minor,
        rl.unit_cost_minor,
        r.received_at,
        greatest(
          0,
          rl.received_base_micros
          - coalesce((
            select sum(prl.returned_base_micros)
            from public.purchase_return_lines prl
            where prl.purchase_receipt_line_id = rl.id
          ), 0)
        )::bigint as available_base
      from public.purchase_receipt_lines rl
      join public.purchase_receipts r on r.id = rl.purchase_receipt_id
      where rl.purchase_order_line_id = v_po_line.id
      order by r.received_at desc, rl.id desc
    loop
      exit when v_remaining <= 0;
      v_receipt_available := v_receipt_line.available_base;
      if v_receipt_available <= 0 then
        continue;
      end if;
      v_alloc := least(v_remaining, v_receipt_available);
      v_alloc_purchase :=
        (v_alloc::numeric * 1000000::numeric)
        / v_po_line.base_micros_per_purchase_unit::numeric;

      insert into public.purchase_return_lines(
        purchase_return_id, purchase_order_line_id, purchase_receipt_line_id,
        inventory_item_id, returned_purchase_units_micros, returned_base_micros,
        purchase_unit_cost_minor, unit_cost_minor
      ) values (
        v_return_id, v_po_line.id, v_receipt_line.id,
        v_po_line.inventory_item_id, round(v_alloc_purchase)::bigint, v_alloc,
        v_receipt_line.purchase_unit_cost_minor, v_receipt_line.unit_cost_minor
      );

      insert into public.supplier_price_history(
        supplier_id, inventory_item_id, purchase_order_id, purchase_return_id,
        source_kind, purchase_unit_label, base_micros_per_purchase_unit,
        purchase_unit_cost_minor, unit_cost_minor
      ) values (
        v_order.supplier_id, v_po_line.inventory_item_id, v_order.id, v_return_id,
        'RETURN', v_po_line.purchase_unit_label, v_po_line.base_micros_per_purchase_unit,
        v_receipt_line.purchase_unit_cost_minor, v_receipt_line.unit_cost_minor
      );

      v_return_value := v_return_value + v_alloc::numeric * v_receipt_line.unit_cost_minor;
      v_remaining := v_remaining - v_alloc;
    end loop;

    if v_remaining <> 0 then
      raise exception 'TUX_PURCHASE_RETURN_ALLOCATION_INVARIANT';
    end if;

    v_current_value := v_on_hand::numeric * v_current_cost;
    v_new_on_hand := v_on_hand - v_returned;
    if v_new_on_hand <= 0 then
      v_inventory_value_removed := v_current_value;
      v_line_purchase_price_variance :=
        (v_return_value - v_inventory_value_removed) / 1000000::numeric;
    elsif v_return_value > v_current_value then
      v_inventory_value_removed := v_returned::numeric * v_current_cost;
      v_line_purchase_price_variance :=
        (v_return_value - v_inventory_value_removed) / 1000000::numeric;
    else
      v_inventory_value_removed := v_return_value;
      v_line_purchase_price_variance := 0;
    end if;
    v_total_purchase_price_variance :=
      v_total_purchase_price_variance + v_line_purchase_price_variance;
    v_weighted_return_cost := v_inventory_value_removed / v_returned::numeric;
    v_new_value := v_current_value - v_inventory_value_removed;
    v_new_cost := case
      when v_new_on_hand <= 0 then 0
      else v_new_value / v_new_on_hand::numeric
    end;

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_shop_id, null, v_po_line.inventory_item_id, 'PURCHASE_RETURN',
      -v_returned, 0, null, null, null,
      'purchase-return:' || p_command_id || ':' || v_po_line.id::text,
      p_employee_id, 'ADMIN', p_command_id, v_weighted_return_cost, now()
    );

    insert into public.inventory_cost_state(
      shop_id, inventory_item_id, weighted_unit_cost_minor, version
    ) values (
      p_shop_id, v_po_line.inventory_item_id, v_new_cost, 1
    )
    on conflict (shop_id, inventory_item_id) do update
    set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
        version = public.inventory_cost_state.version + 1,
        updated_at = now();

    update public.purchase_order_lines
    set returned_purchase_units_micros =
          returned_purchase_units_micros + v_returned_purchase,
        returned_base_micros = returned_base_micros + v_returned,
        updated_at = now()
    where id = v_po_line.id;
  end loop;

  update public.purchase_returns
  set purchase_price_variance_minor = v_total_purchase_price_variance
  where id = v_return_id;

  v_new_version := v_order.version + 1;
  update public.purchase_orders
  set version = v_new_version, updated_at = now()
  where id = v_order.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_RETURNED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object(
      'status', v_order.status, 'version', v_new_version,
      'returnId', v_return_id,
      'supplierReference', nullif(btrim(coalesce(p_supplier_reference, '')), ''),
      'purchasePriceVarianceMinor', v_total_purchase_price_variance
    ),
    null, null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_order.id, 'returnId', v_return_id,
    'status', v_order.status, 'version', v_new_version,
    'purchasePriceVarianceMinor', v_total_purchase_price_variance,
    'idempotentReplay', false
  );
end;
$$;
