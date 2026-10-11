-- Enforce immutable per-payment refund eligibility in both trusted refund execution paths.
-- Retain existing receipt replay before checking policy; settled payment snapshots never change.
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
  order by (rule.shop_id = p_shop_id) desc, rule.id
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
$function$;

CREATE OR REPLACE FUNCTION public.execute_approved_admin_order_refund_v1(p_approval_request_id uuid, p_business_id uuid, p_shop_id uuid, p_requester_employee_id uuid, p_approver_employee_id uuid, p_order_id uuid, p_payment_id uuid, p_amount_minor bigint, p_reason_code_id uuid, p_note text, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_approval public.admin_approval_requests%rowtype;
  v_refund public.admin_order_refunds%rowtype;
  v_payment public.payments%rowtype;
  v_posted bigint;
  v_result jsonb;
  v_expected_payload jsonb;
begin
  if p_approval_request_id is null or p_business_id is null or p_shop_id is null
     or p_requester_employee_id is null or p_approver_employee_id is null
     or p_order_id is null or p_payment_id is null or p_amount_minor is null
     or p_amount_minor <= 0 or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_approved_refund_command');
  end if;

  select * into v_approval
  from public.admin_approval_requests request
  where request.id = p_approval_request_id
    and request.business_id = p_business_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'approval_request_not_found');
  end if;

  v_expected_payload := jsonb_build_object(
    'orderId', p_order_id,
    'paymentId', p_payment_id,
    'amountMinor', p_amount_minor,
    'reasonCodeId', p_reason_code_id,
    'note', nullif(btrim(p_note), ''),
    'orderCommandId', p_command_id
  );

  if v_approval.action_type <> 'ORDER_REFUND'
     or v_approval.shop_id is distinct from p_shop_id
     or v_approval.requester_employee_id <> p_requester_employee_id
     or v_approval.approver_employee_id is distinct from p_approver_employee_id
     or v_approval.command_payload <> v_expected_payload then
    return jsonb_build_object('ok', false, 'code', 'approval_order_payload_mismatch');
  end if;

  if v_approval.status <> 'EXECUTING' then
    return jsonb_build_object('ok', false, 'code', 'approval_not_executing');
  end if;

  select * into v_refund
  from public.admin_order_refunds refund
  where refund.business_id = p_business_id
    and refund.shop_id = p_shop_id
    and refund.approval_request_id = p_approval_request_id
    and refund.command_id = p_command_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'pending_refund_not_found');
  end if;

  if v_refund.order_id <> p_order_id
     or v_refund.payment_id <> p_payment_id
     or v_refund.amount_minor <> p_amount_minor
     or v_refund.reason_code_id <> p_reason_code_id then
    return jsonb_build_object('ok', false, 'code', 'approval_order_payload_mismatch');
  end if;

  if v_refund.state = 'POSTED' then
    return jsonb_build_object(
      'ok', true,
      'orderId', v_refund.order_id,
      'refundId', v_refund.id,
      'state', 'POSTED',
      'replayed', true
    );
  end if;
  if v_refund.state <> 'PENDING_APPROVAL' then
    return jsonb_build_object('ok', false, 'code', 'refund_not_pending_approval');
  end if;

  select * into v_payment
  from public.payments payment
  where payment.id = p_payment_id
    and payment.order_id = p_order_id
    and payment.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_not_found');
  end if;
  if not v_payment.refund_allowed_snapshot then
    return jsonb_build_object('ok', false, 'code', 'refund_not_allowed_for_payment');
  end if;

  select coalesce(sum(refund.amount_minor), 0)
    into v_posted
  from public.admin_order_refunds refund
  where refund.payment_id = p_payment_id
    and refund.state = 'POSTED';

  if v_posted + p_amount_minor > v_payment.allocated_minor then
    return jsonb_build_object('ok', false, 'code', 'refund_exceeds_payment');
  end if;

  update public.admin_order_refunds
  set state = 'POSTED'
  where id = v_refund.id
    and state = 'PENDING_APPROVAL';

  v_result := jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'refundId', v_refund.id,
    'state', 'POSTED',
    'replayed', false
  );

  update public.admin_order_command_receipts
  set result_json = v_result
  where business_id = p_business_id
    and shop_id = p_shop_id
    and command_id = p_command_id
    and command_type = 'REFUND'
    and order_id = p_order_id;

  perform public.append_admin_audit_event_v1(
    p_business_id, p_shop_id, p_approver_employee_id,
    'ORDER_REFUND_POSTED', 'ORDER', p_order_id::text,
    jsonb_build_object('state', 'PENDING_APPROVAL'),
    jsonb_build_object(
      'state', 'POSTED',
      'refundId', v_refund.id,
      'paymentId', p_payment_id,
      'amountMinor', p_amount_minor,
      'reasonCodeId', v_refund.reason_code_id,
      'reasonCodeKey', v_refund.reason_code_key,
      'reasonLabel', v_refund.reason_label_snapshot,
      'reasonFamily', v_refund.reason_family_snapshot,
      'reasonConfigVersion', v_refund.reason_config_version
    ),
    nullif(btrim(p_note), ''), p_approval_request_id, null,
    jsonb_build_object('commandId', p_command_id)
  );

  return v_result;
end;
$function$;

-- Permit audited CAS-fenced edits only after both trusted refund paths enforce immutable eligibility.
CREATE OR REPLACE FUNCTION public.update_admin_payment_method_v1(p_employee_id uuid, p_shop_id uuid, p_payment_method_id uuid, p_display_name text, p_active boolean, p_sort_order integer, p_channel text, p_requires_reference boolean, p_manual_confirmation_required boolean, p_refund_allowed boolean, p_expected_settings_version bigint, p_expected_edit_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_edit_version bigint;
  v_current_refund_allowed boolean;
  v_next_edit_version bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_payment_method_id is null
     or nullif(btrim(p_display_name), '') is null
     or p_active is null or p_sort_order is null
     or p_channel not in ('POS', 'ONLINE', 'BOTH')
     or p_requires_reference is null or p_manual_confirmation_required is null
     or p_refund_allowed is null or p_expected_settings_version is null or p_expected_settings_version < 0
     or p_expected_edit_version is null or p_expected_edit_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payment_method_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(p_employee_id, p_shop_id, 'settings.manage');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0) into v_current_settings_version
  from public.shop_settings_versions s where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  select p.edit_version, p.refund_allowed
    into v_current_edit_version, v_current_refund_allowed
  from public.payment_methods p
  where p.id = p_payment_method_id and p.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_method_not_found');
  end if;
  if v_current_edit_version <> p_expected_edit_version then
    return jsonb_build_object('ok', false, 'code', 'stale_edit_version', 'currentVersion', v_current_edit_version);
  end if;

  v_next_edit_version := v_current_edit_version + 1;
  update public.payment_methods
  set display_name = btrim(p_display_name),
      active = p_active,
      sort_order = p_sort_order,
      channel = p_channel,
      requires_reference = p_requires_reference,
      manual_confirmation_required = p_manual_confirmation_required,
      refund_allowed = p_refund_allowed,
      edit_version = v_next_edit_version,
      updated_at = now()
  where id = p_payment_method_id and shop_id = p_shop_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'SETTINGS_PAYMENT_METHOD_UPDATED', 'PAYMENT_METHOD', p_payment_method_id::text,
    jsonb_build_object('refundAllowed',v_current_refund_allowed,'editVersion',v_current_edit_version),
    jsonb_build_object('refundAllowed',p_refund_allowed,'editVersion',v_next_edit_version),
    null,null,null,'{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'editVersion', v_next_edit_version);
end;
$function$;
