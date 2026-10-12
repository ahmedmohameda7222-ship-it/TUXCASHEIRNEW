-- Correction D cross-action hardening: PostgreSQL DESC sorts NULLS FIRST by
-- default. Global rules evaluate to NULL, and erroneously overshadow local rules.
-- Preserve the rest of the canonical deployed bodies verbatim; only add NULLS LAST.
-- Safe recovery: deactivate the affected specific rule with version fencing,
-- then deploy a forward-only corrected function if needed. No data changes.
CREATE OR REPLACE FUNCTION public.request_admin_order_refund_v1(p_employee_id uuid, p_shop_id uuid, p_order_id uuid, p_payment_id uuid, p_amount_minor bigint, p_reason_code_id uuid, p_note text, p_command_id text, p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_reason record;
  v_existing public.admin_order_command_receipts%rowtype;
  v_fingerprint text;
  v_refunded bigint;
  v_refund_id uuid;
  v_result jsonb;
  v_rule public.admin_approval_rules%rowtype;
  v_requires_approval boolean := false;
  v_approval_command_id uuid;
  v_approval_result jsonb;
  v_approval_request_id uuid;
  v_minimum_minor bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_order_id is null
     or p_payment_id is null or p_amount_minor is null or p_amount_minor <= 0
     or p_reason_code_id is null or p_command_id is null or btrim(p_command_id) = ''
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_refund_command');
  end if;

  select a.business_id into v_business_id
  from private.admin_order_authority_v1(
    p_employee_id, p_shop_id, 'orders.refund'
  ) a;
  if v_business_id is distinct from p_business_id then
    raise exception 'TUX_ADMIN_ORDER_BUSINESS_FORBIDDEN';
  end if;

  select * into v_reason
  from private.admin_order_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'REFUND_RETURN'
  );

  v_fingerprint := private.admin_order_command_fingerprint_v1(
    'REFUND',
    p_order_id,
    jsonb_build_object(
      'paymentId', p_payment_id,
      'amountMinor', p_amount_minor,
      'reasonCodeId', p_reason_code_id,
      'note', nullif(btrim(p_note), '')
    )
  );

  select * into v_existing
  from public.admin_order_command_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id
  for update;
  if found then
    if v_existing.business_id = v_business_id
       and v_existing.command_type = 'REFUND'
       and v_existing.order_id = p_order_id
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if v_order.status not in ('DONE', 'RETURNED') then
    return jsonb_build_object('ok', false, 'code', 'order_not_refundable');
  end if;

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.order_id = p_order_id
    and p.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_not_found');
  end if;
  if not v_payment.refund_allowed_snapshot then
    return jsonb_build_object('ok', false, 'code', 'refund_not_allowed_for_payment');
  end if;

  select coalesce(sum(r.amount_minor), 0)
    into v_refunded
  from public.admin_order_refunds r
  left join public.admin_approval_requests approval
    on approval.id = r.approval_request_id
   and approval.business_id = r.business_id
  where r.payment_id = p_payment_id
    and (
      r.state = 'POSTED'
      or (
        r.state = 'PENDING_APPROVAL'
        and approval.status in ('PENDING', 'APPROVED', 'EXECUTING')
      )
    );

  if v_refunded + p_amount_minor > v_payment.allocated_minor then
    return jsonb_build_object('ok', false, 'code', 'refund_exceeds_payment');
  end if;

  select * into v_rule
  from public.admin_approval_rules rule
  where rule.business_id = v_business_id
    and rule.action_type = 'ORDER_REFUND'
    and rule.active
    and (rule.shop_id is null or rule.shop_id = p_shop_id)
  order by (rule.shop_id = p_shop_id) desc nulls last, rule.id
  limit 1;

  if found then
    if jsonb_typeof(v_rule.threshold_context -> 'minimumMinor') = 'number' then
      begin
        v_minimum_minor := (v_rule.threshold_context ->> 'minimumMinor')::bigint;
      exception when others then
        v_minimum_minor := null;
      end;
      v_requires_approval := v_minimum_minor is null or p_amount_minor >= v_minimum_minor;
    else
      v_requires_approval := true;
    end if;
  end if;

  v_refund_id := gen_random_uuid();

  if v_requires_approval then
    v_approval_command_id := private.admin_order_approval_command_id_v1(
      v_business_id, p_shop_id, 'ORDER_REFUND', p_command_id
    );

    v_approval_result := public.create_admin_approval_request_v1(
      v_business_id,
      p_shop_id,
      p_employee_id,
      null,
      v_rule.id,
      'ORDER_REFUND',
      v_approval_command_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'paymentId', p_payment_id,
        'amountMinor', p_amount_minor,
        'reasonCodeId', p_reason_code_id,
        'note', nullif(btrim(p_note), ''),
        'orderCommandId', p_command_id
      ),
      v_reason.reason_label
    );

    if not coalesce((v_approval_result ->> 'ok')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'code', coalesce(v_approval_result ->> 'code', 'approval_request_failed')
      );
    end if;

    v_approval_request_id := (v_approval_result ->> 'requestId')::uuid;

    insert into public.admin_order_refunds(
      id, business_id, shop_id, order_id, payment_id, amount_minor,
      reason_code_id, reason_code_key, reason_label_snapshot,
      reason_family_snapshot, reason_config_version, note, state,
      approval_request_id, command_id, created_by_employee_id
    ) values (
      v_refund_id, v_business_id, p_shop_id, p_order_id, p_payment_id, p_amount_minor,
      p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
      v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''),
      'PENDING_APPROVAL', v_approval_request_id, p_command_id, p_employee_id
    );

    perform public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id,
      'ORDER_REFUND_APPROVAL_PENDING', 'ORDER', p_order_id::text,
      null,
      jsonb_build_object(
        'refundId', v_refund_id,
        'approvalRequestId', v_approval_request_id,
        'paymentId', p_payment_id,
        'amountMinor', p_amount_minor,
        'reasonCodeId', p_reason_code_id,
        'reasonCodeKey', v_reason.reason_code_key,
        'reasonLabel', v_reason.reason_label,
        'reasonFamily', v_reason.reason_family,
        'reasonConfigVersion', v_reason.reason_version
      ),
      nullif(btrim(p_note), ''), v_approval_request_id, null,
      jsonb_build_object('commandId', p_command_id)
    );

    v_result := jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'refundId', v_refund_id,
      'state', 'PENDING_APPROVAL',
      'approvalRequestId', v_approval_request_id,
      'replayed', false
    );
  else
    insert into public.admin_order_refunds(
      id, business_id, shop_id, order_id, payment_id, amount_minor,
      reason_code_id, reason_code_key, reason_label_snapshot,
      reason_family_snapshot, reason_config_version, note, state,
      command_id, created_by_employee_id
    ) values (
      v_refund_id, v_business_id, p_shop_id, p_order_id, p_payment_id, p_amount_minor,
      p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
      v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''), 'POSTED',
      p_command_id, p_employee_id
    );

    perform public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id,
      'ORDER_REFUND_POSTED', 'ORDER', p_order_id::text,
      null,
      jsonb_build_object(
        'refundId', v_refund_id,
        'paymentId', p_payment_id,
        'amountMinor', p_amount_minor,
        'reasonCodeId', p_reason_code_id,
        'reasonCodeKey', v_reason.reason_code_key,
        'reasonLabel', v_reason.reason_label,
        'reasonFamily', v_reason.reason_family,
        'reasonConfigVersion', v_reason.reason_version
      ),
      nullif(btrim(p_note), ''), null, null,
      jsonb_build_object('commandId', p_command_id)
    );

    v_result := jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'refundId', v_refund_id,
      'state', 'POSTED',
      'replayed', false
    );
  end if;

  insert into public.admin_order_command_receipts(
    business_id, shop_id, command_id, command_type, order_id,
    request_fingerprint, result_json
  ) values (
    v_business_id, p_shop_id, p_command_id, 'REFUND', p_order_id,
    v_fingerprint, v_result
  );

  return v_result;
end;
$function$
;
revoke all on function public.request_admin_order_refund_v1(
  uuid,uuid,uuid,uuid,bigint,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.request_admin_order_refund_v1(
  uuid,uuid,uuid,uuid,bigint,uuid,text,text,uuid
) to service_role;

CREATE OR REPLACE FUNCTION public.return_admin_order_items_v1(p_employee_id uuid, p_shop_id uuid, p_order_id uuid, p_items jsonb, p_reason_code_id uuid, p_note text, p_command_id text, p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_reason record;
  v_existing public.admin_order_command_receipts%rowtype;
  v_fingerprint text;
  v_return_id uuid;
  v_item jsonb;
  v_order_item public.order_items%rowtype;
  v_quantity integer;
  v_prior_quantity bigint;
  v_amount bigint;
  v_modifier_unit_amount bigint;
  v_total_quantity bigint := 0;
  v_result jsonb;
  v_rule public.admin_approval_rules%rowtype;
  v_requires_approval boolean := false;
  v_approval_command_id uuid;
  v_approval_result jsonb;
  v_approval_request_id uuid;
  v_minimum_quantity bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_order_id is null
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or p_reason_code_id is null or p_command_id is null or btrim(p_command_id) = ''
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_return_command');
  end if;

  select a.business_id into v_business_id
  from private.admin_order_authority_v1(
    p_employee_id, p_shop_id, 'orders.refund'
  ) a;
  if v_business_id is distinct from p_business_id then
    raise exception 'TUX_ADMIN_ORDER_BUSINESS_FORBIDDEN';
  end if;

  select * into v_reason
  from private.admin_order_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'REFUND_RETURN'
  );

  v_fingerprint := private.admin_order_command_fingerprint_v1(
    'RETURN',
    p_order_id,
    jsonb_build_object(
      'items', p_items,
      'reasonCodeId', p_reason_code_id,
      'note', nullif(btrim(p_note), '')
    )
  );

  select * into v_existing
  from public.admin_order_command_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id
  for update;
  if found then
    if v_existing.business_id = v_business_id
       and v_existing.command_type = 'RETURN'
       and v_existing.order_id = p_order_id
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if v_order.status not in ('DONE', 'RETURNED') then
    return jsonb_build_object('ok', false, 'code', 'order_not_returnable');
  end if;

  -- Lock all requested order-item rows in a stable order before validating quantities.
  -- Pending approvals reserve capacity while their approval remains actionable.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'orderItemId'
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
      if v_quantity <= 0 then raise exception 'invalid'; end if;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_item');
    end;

    select * into v_order_item
    from public.order_items i
    where i.id = (v_item ->> 'orderItemId')::uuid
      and i.order_id = p_order_id
      and i.shop_id = p_shop_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'return_item_not_found');
    end if;

    select coalesce(sum(ri.quantity), 0)
      into v_prior_quantity
    from public.admin_order_return_items ri
    join public.admin_order_returns r on r.id = ri.return_id
    left join public.admin_approval_requests approval
      on approval.id = r.approval_request_id
     and approval.business_id = r.business_id
    where ri.order_item_id = v_order_item.id
      and (
        r.state = 'POSTED'
        or (
          r.state = 'PENDING_APPROVAL'
          and approval.status in ('PENDING', 'APPROVED', 'EXECUTING')
        )
      );

    if v_prior_quantity + v_quantity > v_order_item.quantity then
      return jsonb_build_object('ok', false, 'code', 'return_quantity_exceeded');
    end if;

    v_total_quantity := v_total_quantity + v_quantity;
  end loop;

  select * into v_rule
  from public.admin_approval_rules rule
  where rule.business_id = v_business_id
    and rule.action_type = 'ORDER_RETURN'
    and rule.active
    and (rule.shop_id is null or rule.shop_id = p_shop_id)
  order by (rule.shop_id = p_shop_id) desc nulls last, rule.id
  limit 1;

  if found then
    if jsonb_typeof(v_rule.threshold_context -> 'minimumQuantityImpact') = 'number' then
      begin
        v_minimum_quantity := (v_rule.threshold_context ->> 'minimumQuantityImpact')::bigint;
      exception when others then
        v_minimum_quantity := null;
      end;
      v_requires_approval :=
        v_minimum_quantity is null or v_total_quantity >= v_minimum_quantity;
    else
      v_requires_approval := true;
    end if;
  end if;

  v_return_id := gen_random_uuid();

  if v_requires_approval then
    v_approval_command_id := private.admin_order_approval_command_id_v1(
      v_business_id, p_shop_id, 'ORDER_RETURN', p_command_id
    );

    v_approval_result := public.create_admin_approval_request_v1(
      v_business_id,
      p_shop_id,
      p_employee_id,
      null,
      v_rule.id,
      'ORDER_RETURN',
      v_approval_command_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'items', p_items,
        'reasonCodeId', p_reason_code_id,
        'note', nullif(btrim(p_note), ''),
        'orderCommandId', p_command_id
      ),
      v_reason.reason_label
    );

    if not coalesce((v_approval_result ->> 'ok')::boolean, false) then
      return jsonb_build_object(
        'ok', false,
        'code', coalesce(v_approval_result ->> 'code', 'approval_request_failed')
      );
    end if;

    v_approval_request_id := (v_approval_result ->> 'requestId')::uuid;

    insert into public.admin_order_returns(
      id, business_id, shop_id, order_id,
      reason_code_id, reason_code_key, reason_label_snapshot,
      reason_family_snapshot, reason_config_version, note, state,
      approval_request_id, command_id, created_by_employee_id
    ) values (
      v_return_id, v_business_id, p_shop_id, p_order_id,
      p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
      v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''),
      'PENDING_APPROVAL', v_approval_request_id, p_command_id, p_employee_id
    );
  else
    insert into public.admin_order_returns(
      id, business_id, shop_id, order_id,
      reason_code_id, reason_code_key, reason_label_snapshot,
      reason_family_snapshot, reason_config_version, note, state,
      command_id, created_by_employee_id
    ) values (
      v_return_id, v_business_id, p_shop_id, p_order_id,
      p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
      v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''),
      'POSTED', p_command_id, p_employee_id
    );
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_order_item
    from public.order_items i
    where i.id = (v_item ->> 'orderItemId')::uuid
      and i.order_id = p_order_id
      and i.shop_id = p_shop_id;

    select coalesce(sum(m.unit_price_minor * m.quantity), 0)::bigint
      into v_modifier_unit_amount
    from public.order_item_modifiers m
    where m.order_item_id = v_order_item.id
      and m.shop_id = p_shop_id;

    v_amount :=
      (v_order_item.unit_price_minor + v_modifier_unit_amount) * v_quantity;
    insert into public.admin_order_return_items(
      return_id, order_item_id, quantity, amount_minor
    ) values (
      v_return_id, v_order_item.id, v_quantity, v_amount
    );
  end loop;

  if v_requires_approval then
    perform public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id,
      'ORDER_RETURN_APPROVAL_PENDING', 'ORDER', p_order_id::text,
      null,
      jsonb_build_object(
        'returnId', v_return_id,
        'approvalRequestId', v_approval_request_id,
        'items', p_items,
        'reasonCodeId', p_reason_code_id,
        'reasonCodeKey', v_reason.reason_code_key,
        'reasonLabel', v_reason.reason_label,
        'reasonFamily', v_reason.reason_family,
        'reasonConfigVersion', v_reason.reason_version
      ),
      nullif(btrim(p_note), ''), v_approval_request_id, null,
      jsonb_build_object('commandId', p_command_id)
    );

    v_result := jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'returnId', v_return_id,
      'state', 'PENDING_APPROVAL',
      'approvalRequestId', v_approval_request_id,
      'replayed', false
    );
  else
    perform public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id,
      'ORDER_ITEMS_RETURNED', 'ORDER', p_order_id::text,
      null,
      jsonb_build_object(
        'returnId', v_return_id,
        'items', p_items,
        'reasonCodeId', p_reason_code_id,
        'reasonCodeKey', v_reason.reason_code_key,
        'reasonLabel', v_reason.reason_label,
        'reasonFamily', v_reason.reason_family,
        'reasonConfigVersion', v_reason.reason_version
      ),
      nullif(btrim(p_note), ''), null, null,
      jsonb_build_object('commandId', p_command_id)
    );

    v_result := jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'returnId', v_return_id,
      'state', 'POSTED',
      'replayed', false
    );
  end if;

  insert into public.admin_order_command_receipts(
    business_id, shop_id, command_id, command_type, order_id,
    request_fingerprint, result_json
  ) values (
    v_business_id, p_shop_id, p_command_id, 'RETURN', p_order_id,
    v_fingerprint, v_result
  );

  return v_result;
end;
$function$
;
revoke all on function public.return_admin_order_items_v1(
  uuid,uuid,uuid,jsonb,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.return_admin_order_items_v1(
  uuid,uuid,uuid,jsonb,uuid,text,text,uuid
) to service_role;
