-- Forward-only archive approval hardening: no historical migrations changed.
-- Archive uses existing SHOP_LIFECYCLE_CHANGE version-fenced approval/runner/receipt.
-- Legacy deletion remains for unused shops only. Pending lifecycle decisions
-- cannot be bypassed by switching payload after an approval rule is disabled.
CREATE OR REPLACE FUNCTION public.update_admin_shop_lifecycle_v1(p_employee_id uuid, p_shop_id uuid, p_expected_lifecycle_revision bigint, p_expected_state text, p_target_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_current public.shops%ROWTYPE;
  v_actor_role text;
  v_next_revision bigint;
BEGIN
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'shops.manage'
  );
  IF p_expected_lifecycle_revision IS NULL OR p_expected_lifecycle_revision < 1
    OR p_expected_state NOT IN ('ACTIVE', 'SUSPENDED')
    OR p_target_state NOT IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')
    OR p_expected_state = p_target_state THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_lifecycle_transition');
  END IF;

  -- A configured rule must bind this exact transition to a claimed,
  -- distinct-person approval. An exposed direct Settings RPC cannot bypass it.
  IF (
    EXISTS (
      SELECT 1 FROM public.admin_approval_rules r
      WHERE r.business_id=v_business_id AND r.action_type='SHOP_LIFECYCLE_CHANGE'
        AND r.active AND (r.shop_id=p_shop_id OR r.shop_id IS NULL)
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_approval_requests open_request
      WHERE open_request.business_id=v_business_id
        AND open_request.shop_id=p_shop_id
        AND open_request.action_type='SHOP_LIFECYCLE_CHANGE'
        AND open_request.status IN ('PENDING','APPROVED','EXECUTING')
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.admin_approval_requests a
    WHERE a.id = nullif(
      current_setting('tux.approved_shop_lifecycle_request_id',true),''
    )::uuid
      AND a.business_id=v_business_id AND a.shop_id=p_shop_id
      AND a.action_type='SHOP_LIFECYCLE_CHANGE'
      AND a.requester_employee_id=p_employee_id
      AND a.approver_employee_id IS NOT NULL
      AND a.approver_employee_id<>p_employee_id
      AND a.status='EXECUTING'
      AND a.command_payload=jsonb_build_object(
        'shopId',p_shop_id,'expectedLifecycleRevision',p_expected_lifecycle_revision,
        'expectedState',p_expected_state,'targetState',p_target_state)
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','shop_lifecycle_approval_required');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0)
  );
  SELECT s.* INTO v_current
  FROM public.shops s
  JOIN public.business_shops bs
    ON bs.shop_id = s.id AND bs.business_id = v_business_id
  WHERE s.id = p_shop_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'shop_not_found');
  END IF;
  IF v_current.lifecycle_state = 'ARCHIVED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'archived_shop_cannot_reactivate');
  END IF;
  IF v_current.lifecycle_revision <> p_expected_lifecycle_revision
    OR v_current.lifecycle_state <> p_expected_state THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_shop_lifecycle',
      'currentVersion', v_current.lifecycle_revision);
  END IF;

  v_next_revision := v_current.lifecycle_revision + 1;
  -- Suspensions close operational intake; reactivation never silently reopens it.
  UPDATE public.shops SET
    lifecycle_state = p_target_state,
    lifecycle_revision = v_next_revision,
    active = (p_target_state = 'ACTIVE'),
    temporary_closed = true,
    online_orders_paused = true,
    updated_at = now()
  WHERE id = p_shop_id;

  SELECT e.role INTO STRICT v_actor_role
  FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;
  INSERT INTO public.admin_audit_events (
    business_id, shop_id, actor_kind, actor_employee_id, actor_role,
    action_type, entity_type, entity_id, before_value, after_value
  ) VALUES (
    v_business_id, p_shop_id, 'HUMAN', p_employee_id, v_actor_role,
    'shop.lifecycle.update', 'shop', p_shop_id::text,
    jsonb_build_object('state', v_current.lifecycle_state,
      'revision', v_current.lifecycle_revision,
      'temporaryClosed', v_current.temporary_closed,
      'onlineOrdersPaused', v_current.online_orders_paused),
    jsonb_build_object('state', p_target_state,
      'revision', v_next_revision,
      'temporaryClosed', true, 'onlineOrdersPaused', true)
  );
  RETURN jsonb_build_object('ok', true, 'lifecycleRevision', v_next_revision);
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_approved_admin_shop_lifecycle_v1(p_approval_request_id uuid, p_business_id uuid, p_shop_id uuid, p_requester_employee_id uuid, p_approver_employee_id uuid, p_expected_lifecycle_revision bigint, p_expected_state text, p_target_state text, p_command_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_approval public.admin_approval_requests%rowtype;
  v_receipt private.admin_shop_lifecycle_approval_receipts%rowtype;
  v_expected jsonb;
  v_result jsonb;
  v_owner_business uuid;
  v_approver_business uuid;
begin
  if p_approval_request_id is null or p_business_id is null or
     p_shop_id is null or p_requester_employee_id is null or
     p_approver_employee_id is null or p_command_id is null or
     p_expected_lifecycle_revision is null or p_expected_lifecycle_revision<1 or
     p_expected_state not in ('ACTIVE','SUSPENDED') or
     p_target_state not in ('ACTIVE','SUSPENDED','ARCHIVED') or
     p_expected_state=p_target_state then
    return jsonb_build_object('ok',false,'code','invalid_approved_shop_lifecycle');
  end if;

  select * into v_approval from public.admin_approval_requests
  where id=p_approval_request_id and business_id=p_business_id for update;
  if not found then return jsonb_build_object(
    'ok',false,'code','approval_request_not_found'); end if;
  v_expected:=jsonb_build_object(
    'shopId',p_shop_id,'expectedLifecycleRevision',p_expected_lifecycle_revision,
    'expectedState',p_expected_state,'targetState',p_target_state);
  if v_approval.action_type<>'SHOP_LIFECYCLE_CHANGE' or
     v_approval.shop_id is distinct from p_shop_id or
     v_approval.requester_employee_id<>p_requester_employee_id or
     v_approval.approver_employee_id is distinct from p_approver_employee_id or
     v_approval.command_id<>p_command_id or
     v_approval.command_payload<>v_expected or
     v_approval.required_approver_permission<>'approvals.review' or
     v_approval.requester_employee_id=p_approver_employee_id or
     v_approval.status not in ('EXECUTING','EXECUTED') then
    return jsonb_build_object('ok',false,
      'code','approval_shop_lifecycle_payload_or_state_mismatch');
  end if;
  -- Revalidate both humans' CURRENT trusted business/shop authority, not
  -- only the permission snapshot captured at the approval decision.
  v_owner_business:=private.assert_admin_settings_permission_v1(
    p_requester_employee_id,p_shop_id,'shops.manage');
  v_approver_business:=private.assert_admin_settings_permission_v1(
    p_approver_employee_id,p_shop_id,'approvals.review');
  if v_owner_business is distinct from p_business_id or
     v_approver_business is distinct from p_business_id then
    return jsonb_build_object('ok',false,
      'code','approval_shop_lifecycle_business_mismatch');
  end if;

  select * into v_receipt from private.admin_shop_lifecycle_approval_receipts
   where approval_request_id=p_approval_request_id for update;
  if found then
    if v_receipt.business_id<>p_business_id or
       v_receipt.shop_id<>p_shop_id or v_receipt.command_id<>p_command_id or
       v_receipt.expected_lifecycle_revision<>p_expected_lifecycle_revision then
      return jsonb_build_object('ok',false,
        'code','approval_shop_lifecycle_receipt_conflict');
    end if;
    return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
  end if;
  if v_approval.status<>'EXECUTING' then
    return jsonb_build_object('ok',false,
      'code','approval_shop_lifecycle_not_claimed');
  end if;
  perform set_config('tux.approved_shop_lifecycle_request_id',
    p_approval_request_id::text,true);
  v_result:=public.update_admin_shop_lifecycle_v1(
    p_requester_employee_id,p_shop_id,p_expected_lifecycle_revision,
    p_expected_state,p_target_state);
  perform set_config('tux.approved_shop_lifecycle_request_id','',true);
  if v_result->>'ok' is distinct from 'true' then return v_result; end if;

  insert into private.admin_shop_lifecycle_approval_receipts(
    approval_request_id,business_id,shop_id,command_id,
    expected_lifecycle_revision,new_lifecycle_revision,result_json
  ) values (
    p_approval_request_id,p_business_id,p_shop_id,p_command_id,
    p_expected_lifecycle_revision,(v_result->>'lifecycleRevision')::bigint,v_result
  );
  perform public.append_admin_audit_event_v1(
    p_business_id,p_shop_id,p_approver_employee_id,
    'SHOP_LIFECYCLE_APPROVED_APPLIED','SHOP',p_shop_id::text,
    jsonb_build_object('state',p_expected_state,
      'revision',p_expected_lifecycle_revision),
    jsonb_build_object('state',p_target_state,
      'revision',(v_result->>'lifecycleRevision')::bigint),
    null,p_approval_request_id,null,
    jsonb_build_object('commandId',p_command_id)
  );
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_or_archive_shop_v1(p_employee_id uuid, p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ declare v_business_id uuid;v_used boolean; begin v_business_id:=private.assert_admin_settings_permission_v1(p_employee_id,p_shop_id,'shops.manage'); perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_shop_id::text,0)); perform 1 from public.shops s where s.id=p_shop_id for update; if not found then return jsonb_build_object('ok',false,'code','shop_not_found'); end if; if exists(select 1 from public.admin_approval_requests a where a.business_id=v_business_id and a.shop_id=p_shop_id and a.action_type='SHOP_LIFECYCLE_CHANGE' and a.status in ('PENDING','APPROVED','EXECUTING')) then return jsonb_build_object('ok',false,'code','shop_lifecycle_approval_required'); end if; select (exists(select 1 from public.business_days x where x.shop_id=p_shop_id) or exists(select 1 from public.orders x where x.shop_id=p_shop_id) or exists(select 1 from public.operations_configuration_snapshots x where x.shop_id=p_shop_id) or exists(select 1 from public.menu_categories x where x.shop_id=p_shop_id) or exists(select 1 from public.products x where x.shop_id=p_shop_id) or exists(select 1 from public.modifiers x where x.shop_id=p_shop_id) or exists(select 1 from public.inventory_items x where x.shop_id=p_shop_id) or exists(select 1 from public.order_types x where x.shop_id=p_shop_id) or exists(select 1 from public.payment_methods x where x.shop_id=p_shop_id) or exists(select 1 from public.delivery_zones x where x.shop_id=p_shop_id) or exists(select 1 from public.customer_contacts x where x.shop_id=p_shop_id) or exists(select 1 from public.devices x where x.shop_id=p_shop_id) or exists(select 1 from public.workers x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_memberships x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_category_shop_bindings x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_product_shop_overrides x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_drafts x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_publish_versions x where x.shop_id=p_shop_id) or exists(select 1 from public.scheduled_config_changes x where x.shop_id=p_shop_id) or exists(select 1 from public.recurring_availability_rules x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_setting_overrides x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_settings_versions x where x.shop_id=p_shop_id) or exists(select 1 from public.admin_reason_codes x where x.shop_id=p_shop_id) or exists(select 1 from public.payment_method_zone_rules x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_weekly_hours x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_special_hours x where x.shop_id=p_shop_id) or exists(select 1 from public.admin_audit_events x where x.business_id=v_business_id and x.shop_id=p_shop_id)) into v_used; if v_used then return jsonb_build_object('ok',false,'code','shop_archive_use_lifecycle_command'); end if; delete from public.business_shops where business_id=v_business_id and shop_id=p_shop_id; delete from public.shops where id=p_shop_id; return jsonb_build_object('ok',true,'action','DELETED'); end; $function$;

REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,bigint,text,text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_approved_admin_shop_lifecycle_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_or_archive_shop_v1(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_approved_admin_shop_lifecycle_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_or_archive_shop_v1(uuid,uuid) TO service_role;
