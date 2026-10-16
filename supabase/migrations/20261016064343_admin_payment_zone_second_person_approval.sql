-- Plan 3 payment-zone approval: function-only forward amendment, private
-- exactly-once receipt and explicit second-person authorization.
-- Does not modify operational records or published historical payments.
CREATE TABLE IF NOT EXISTS private.admin_payment_zone_approval_receipts (
  approval_request_id uuid PRIMARY KEY REFERENCES public.admin_approval_requests(id),
  business_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  delivery_zone_id uuid NOT NULL,
  approval_command_id uuid NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,shop_id,approval_command_id)
);
ALTER TABLE private.admin_payment_zone_approval_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.admin_payment_zone_approval_receipts
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.upsert_admin_payment_zone_rule_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_payment_method_id uuid,
  p_delivery_zone_id uuid,
  p_allowed boolean,
  p_expected_allowed boolean,
  p_expected_settings_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_settings_version bigint;
  v_previous_allowed boolean;
  v_existed boolean;
  v_actor_role text;
BEGIN
  IF p_employee_id IS NULL OR p_shop_id IS NULL OR p_payment_method_id IS NULL
     OR p_delivery_zone_id IS NULL OR p_allowed IS NULL
     OR p_expected_settings_version IS NULL OR p_expected_settings_version < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payment_zone_rule');
  END IF;
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0)
  );

  -- Active policy and open command locks protect against direct service
  -- calls and against changing a pending command after the rule is disabled.
  IF (
    EXISTS (
      SELECT 1 FROM public.admin_approval_rules ar
      WHERE ar.business_id=v_business_id
        AND ar.action_type='SETTINGS_PAYMENT_ZONE_CHANGE'
        AND ar.active AND (ar.shop_id=p_shop_id OR ar.shop_id IS NULL)
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_approval_requests ar
      WHERE ar.business_id=v_business_id AND ar.shop_id=p_shop_id
        AND ar.action_type='SETTINGS_PAYMENT_ZONE_CHANGE'
        AND ar.status IN ('PENDING','APPROVED','EXECUTING')
        AND ar.command_payload->>'paymentMethodId'=p_payment_method_id::text
        AND ar.command_payload->>'deliveryZoneId'=p_delivery_zone_id::text
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.admin_approval_requests a
    WHERE a.id=nullif(
      current_setting('tux.approved_payment_zone_request_id',true),''
    )::uuid
      AND a.business_id=v_business_id AND a.shop_id=p_shop_id
      AND a.action_type='SETTINGS_PAYMENT_ZONE_CHANGE'
      AND a.requester_employee_id=p_employee_id
      AND a.approver_employee_id IS NOT NULL
      AND a.approver_employee_id<>p_employee_id
      AND a.status='EXECUTING'
      AND a.command_payload=jsonb_build_object(
        'shopId',p_shop_id,'paymentMethodId',p_payment_method_id,
        'deliveryZoneId',p_delivery_zone_id,'allowed',p_allowed,
        'expectedAllowed',p_expected_allowed,
        'expectedSettingsVersion',p_expected_settings_version)
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','payment_zone_approval_required');
  END IF;

  SELECT COALESCE(MAX(v.settings_version), 0) INTO v_settings_version
  FROM public.shop_settings_versions v
  WHERE v.business_id = v_business_id AND v.shop_id = p_shop_id;
  IF v_settings_version <> p_expected_settings_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_settings_version',
      'currentVersion', v_settings_version);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_methods p
    WHERE p.shop_id = p_shop_id AND p.id = p_payment_method_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.delivery_zones z
    WHERE z.shop_id = p_shop_id AND z.id = p_delivery_zone_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payment_zone_scope');
  END IF;
  SELECT r.allowed INTO v_previous_allowed
  FROM public.payment_method_zone_rules r
  WHERE r.business_id = v_business_id AND r.shop_id = p_shop_id
    AND r.payment_method_id = p_payment_method_id
    AND r.delivery_zone_id = p_delivery_zone_id
  FOR UPDATE;
  v_existed := FOUND;
  IF (v_existed AND (p_expected_allowed IS NULL OR p_expected_allowed <> v_previous_allowed))
     OR (NOT v_existed AND p_expected_allowed IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_payment_zone_rule');
  END IF;
  INSERT INTO public.payment_method_zone_rules(
    business_id, shop_id, payment_method_id, delivery_zone_id, allowed
  ) VALUES (
    v_business_id, p_shop_id, p_payment_method_id, p_delivery_zone_id, p_allowed
  )
  ON CONFLICT (payment_method_id, delivery_zone_id)
  DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = now()
  WHERE public.payment_method_zone_rules.business_id = v_business_id
    AND public.payment_method_zone_rules.shop_id = p_shop_id;
  SELECT e.role INTO STRICT v_actor_role
  FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;
  INSERT INTO public.admin_audit_events(
    business_id, shop_id, actor_kind, actor_employee_id, actor_role,
    action_type, entity_type, entity_id, before_value, after_value
  ) VALUES (
    v_business_id, p_shop_id, 'HUMAN', p_employee_id, v_actor_role,
    'payment.zone.rule.upsert', 'payment_method_zone_rule',
    p_payment_method_id::text || ':' || p_delivery_zone_id::text,
    CASE WHEN v_existed THEN jsonb_build_object('allowed', v_previous_allowed) ELSE NULL END,
    jsonb_build_object('allowed', p_allowed)
  );
  RETURN jsonb_build_object('ok', true);
END;
$function$;


CREATE OR REPLACE FUNCTION public.execute_approved_admin_payment_zone_rule_v1(
  p_approval_request_id uuid, p_business_id uuid, p_shop_id uuid,
  p_requester_employee_id uuid, p_approver_employee_id uuid,
  p_payment_method_id uuid, p_delivery_zone_id uuid,
  p_allowed boolean, p_expected_allowed boolean,
  p_expected_settings_version bigint, p_command_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private
AS $approved_payment_zone$
DECLARE
  v_approval public.admin_approval_requests%ROWTYPE;
  v_receipt private.admin_payment_zone_approval_receipts%ROWTYPE;
  v_expected jsonb;
  v_result jsonb;
  v_requester_business uuid;
  v_approver_business uuid;
BEGIN
  IF p_approval_request_id IS NULL OR p_business_id IS NULL
    OR p_shop_id IS NULL OR p_requester_employee_id IS NULL
    OR p_approver_employee_id IS NULL OR p_payment_method_id IS NULL
    OR p_delivery_zone_id IS NULL OR p_allowed IS NULL
    OR p_expected_settings_version IS NULL OR p_expected_settings_version<0
    OR p_command_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_approved_payment_zone');
  END IF;
  SELECT * INTO v_approval FROM public.admin_approval_requests
    WHERE id=p_approval_request_id AND business_id=p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','approval_request_not_found');
  END IF;
  v_expected:=jsonb_build_object(
    'shopId',p_shop_id,'paymentMethodId',p_payment_method_id,
    'deliveryZoneId',p_delivery_zone_id,'allowed',p_allowed,
    'expectedAllowed',p_expected_allowed,
    'expectedSettingsVersion',p_expected_settings_version);
  IF v_approval.action_type<>'SETTINGS_PAYMENT_ZONE_CHANGE'
    OR v_approval.shop_id IS DISTINCT FROM p_shop_id
    OR v_approval.requester_employee_id<>p_requester_employee_id
    OR v_approval.approver_employee_id IS DISTINCT FROM p_approver_employee_id
    OR v_approval.requester_employee_id=p_approver_employee_id
    OR v_approval.required_approver_permission<>'approvals.review'
    OR NOT v_approval.requires_second_person
    OR v_approval.command_id<>p_command_id
    OR v_approval.command_payload<>v_expected
    OR v_approval.status NOT IN ('EXECUTING','EXECUTED') THEN
    RETURN jsonb_build_object('ok',false,
      'code','approval_payment_zone_payload_or_state_mismatch');
  END IF;
  v_requester_business:=private.assert_admin_settings_permission_v1(
    p_requester_employee_id,p_shop_id,'settings.manage');
  v_approver_business:=private.assert_admin_settings_permission_v1(
    p_approver_employee_id,p_shop_id,'approvals.review');
  IF v_requester_business IS DISTINCT FROM p_business_id
     OR v_approver_business IS DISTINCT FROM p_business_id THEN
    RETURN jsonb_build_object('ok',false,'code','approval_payment_zone_business_mismatch');
  END IF;
  SELECT * INTO v_receipt FROM private.admin_payment_zone_approval_receipts
    WHERE approval_request_id=p_approval_request_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.business_id<>p_business_id OR v_receipt.shop_id<>p_shop_id
      OR v_receipt.payment_method_id<>p_payment_method_id
      OR v_receipt.delivery_zone_id<>p_delivery_zone_id
      OR v_receipt.approval_command_id<>p_command_id THEN
      RETURN jsonb_build_object('ok',false,'code','approval_payment_zone_receipt_conflict');
    END IF;
    RETURN v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
  END IF;
  IF v_approval.status<>'EXECUTING' THEN
    RETURN jsonb_build_object('ok',false,'code','approval_payment_zone_not_claimed');
  END IF;
  PERFORM set_config('tux.approved_payment_zone_request_id',p_approval_request_id::text,true);
  v_result:=public.upsert_admin_payment_zone_rule_v1(
    p_requester_employee_id,p_shop_id,p_payment_method_id,p_delivery_zone_id,
    p_allowed,p_expected_allowed,p_expected_settings_version);
  PERFORM set_config('tux.approved_payment_zone_request_id','',true);
  IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_result; END IF;
  INSERT INTO private.admin_payment_zone_approval_receipts(
    approval_request_id,business_id,shop_id,payment_method_id,
    delivery_zone_id,approval_command_id,result_json
  ) VALUES (
    p_approval_request_id,p_business_id,p_shop_id,p_payment_method_id,
    p_delivery_zone_id,p_command_id,v_result
  );
  PERFORM public.append_admin_audit_event_v1(
    p_business_id,p_shop_id,p_approver_employee_id,
    'SETTINGS_PAYMENT_ZONE_APPROVED_APPLIED','PAYMENT_ZONE_RULE',
    p_payment_method_id::text||':'||p_delivery_zone_id::text,
    jsonb_build_object('allowed',p_expected_allowed),
    jsonb_build_object('allowed',p_allowed),
    null,p_approval_request_id,null,jsonb_build_object('commandId',p_command_id)
  );
  RETURN v_result;
END;
$approved_payment_zone$;

REVOKE ALL ON FUNCTION public.upsert_admin_payment_zone_rule_v1(
  uuid,uuid,uuid,uuid,boolean,boolean,bigint
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_admin_payment_zone_rule_v1(
  uuid,uuid,uuid,uuid,boolean,boolean,bigint
) TO service_role;
REVOKE ALL ON FUNCTION public.execute_approved_admin_payment_zone_rule_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,boolean,bigint,uuid
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_approved_admin_payment_zone_rule_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,boolean,bigint,uuid
) TO service_role;
