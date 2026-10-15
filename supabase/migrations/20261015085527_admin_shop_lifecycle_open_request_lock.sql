-- PR #119/Plans 2–3: an already-open SHOP_LIFECYCLE_CHANGE cannot be
-- bypassed merely by disabling its rule after request creation.
-- Every exact pending/approved/executing transition stays approval-locked
-- even if the policy is later disabled. Keep independent CAS, shop ownership,
-- distinct-person and private receipt invariants untouched.
-- Forward-only function replacement, no operational DML or privilege changes.

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
    OR p_target_state NOT IN ('ACTIVE', 'SUSPENDED')
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
        AND open_request.command_payload=jsonb_build_object(
          'shopId',p_shop_id,
          'expectedLifecycleRevision',p_expected_lifecycle_revision,
          'expectedState',p_expected_state,
          'targetState',p_target_state)
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
