-- Canonical approval-rule management. Historical approval requests remain immutable.
ALTER TABLE public.admin_approval_rules
  ADD COLUMN IF NOT EXISTS edit_version bigint NOT NULL DEFAULT 1;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.admin_approval_rules'::regclass
      AND conname = 'admin_approval_rules_edit_version_positive_ck'
  ) THEN
    ALTER TABLE public.admin_approval_rules
      ADD CONSTRAINT admin_approval_rules_edit_version_positive_ck
      CHECK (edit_version > 0);
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.upsert_admin_approval_rule_v1(
  p_employee_id uuid,
  p_reference_shop_id uuid,
  p_rule_id uuid,
  p_rule_shop_id uuid,
  p_action_type text,
  p_requester_permission text,
  p_approver_permission text,
  p_requires_second_person boolean,
  p_requires_requester_repin boolean,
  p_expires_after_seconds integer,
  p_threshold_context jsonb,
  p_active boolean,
  p_expected_edit_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_previous public.admin_approval_rules%ROWTYPE;
  v_rule_id uuid;
  v_next_edit_version bigint;
  v_actor_role text;
  v_key text;
  v_value jsonb;
  v_count integer;
  v_value_numeric numeric;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_employee_id IS NULL OR p_reference_shop_id IS NULL
     OR p_action_type IS NULL
     OR p_action_type !~ '^[A-Za-z][A-Za-z0-9_.-]{0,119}$'
     OR p_requester_permission IS NULL
     OR p_approver_permission IS DISTINCT FROM 'approvals.review'
     OR p_requires_second_person IS NULL
     OR p_requires_requester_repin IS NULL
     OR p_active IS NULL
     OR p_expires_after_seconds IS NULL
     OR p_expires_after_seconds NOT BETWEEN 60 AND 604800
     OR p_threshold_context IS NULL
     OR jsonb_typeof(p_threshold_context) <> 'object'
     OR (p_rule_id IS NULL AND p_expected_edit_version IS NOT NULL)
     OR (p_rule_id IS NOT NULL AND (p_expected_edit_version IS NULL OR p_expected_edit_version < 1))
  THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_approval_rule');
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_each(p_threshold_context);
  IF v_count > 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unsupported_approval_threshold');
  END IF;
  IF v_count = 1 THEN
    SELECT key, value INTO v_key, v_value FROM jsonb_each(p_threshold_context);
    IF v_key NOT IN ('minimumMinor', 'minimumQuantityImpact')
       OR jsonb_typeof(v_value) <> 'number'
    THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unsupported_approval_threshold');
    END IF;
    IF (v_value::text) !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unsupported_approval_threshold');
    END IF;
    v_value_numeric := (v_value::text)::numeric;
    IF v_value_numeric < 1 OR v_value_numeric > 9007199254740991 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'unsupported_approval_threshold');
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_permissions
    WHERE permission_key = p_requester_permission
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_requester_permission');
  END IF;

  IF p_rule_shop_id IS NULL THEN
    v_business_id := private.assert_admin_business_settings_permission_v1(
      p_employee_id, p_reference_shop_id, 'settings.manage'
    );
  ELSE
    IF p_reference_shop_id <> p_rule_shop_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_shop_scope');
    END IF;
    v_business_id := private.assert_admin_settings_permission_v1(
      p_employee_id, p_rule_shop_id, 'settings.manage'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-approval-rule:' || v_business_id::text
      || ':' || COALESCE(p_rule_shop_id::text, 'business')
      || ':' || p_action_type, 0)
  );

  IF p_rule_id IS NOT NULL THEN
    SELECT r.* INTO v_previous
    FROM public.admin_approval_rules r
    WHERE r.id = p_rule_id AND r.business_id = v_business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'approval_rule_not_found');
    END IF;
    IF v_previous.shop_id IS DISTINCT FROM p_rule_shop_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'approval_rule_scope_locked');
    END IF;
    IF v_previous.edit_version <> p_expected_edit_version THEN
      RETURN jsonb_build_object('ok', false, 'code', 'stale_approval_rule_version',
        'currentVersion', v_previous.edit_version);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_approval_rules r
    WHERE r.business_id = v_business_id
      AND r.shop_id IS NOT DISTINCT FROM p_rule_shop_id
      AND r.action_type = p_action_type
      AND (p_rule_id IS NULL OR r.id <> p_rule_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_approval_rule');
  END IF;

  IF p_rule_id IS NULL THEN
    INSERT INTO public.admin_approval_rules (
      business_id, shop_id, action_type, requester_permission,
      approver_permission, requires_second_person, requires_requester_repin,
      expires_after_seconds, threshold_context, active, edit_version
    ) VALUES (
      v_business_id, p_rule_shop_id, p_action_type, p_requester_permission,
      p_approver_permission, p_requires_second_person, p_requires_requester_repin,
      p_expires_after_seconds, p_threshold_context, p_active, 1
    ) RETURNING id, edit_version INTO v_rule_id, v_next_edit_version;
    v_before := null;
  ELSE
    v_rule_id := p_rule_id;
    v_next_edit_version := v_previous.edit_version + 1;
    v_before := jsonb_build_object(
      'actionType', v_previous.action_type,
      'active', v_previous.active,
      'threshold', v_previous.threshold_context,
      'version', v_previous.edit_version
    );
    UPDATE public.admin_approval_rules SET
      action_type = p_action_type,
      requester_permission = p_requester_permission,
      approver_permission = p_approver_permission,
      requires_second_person = p_requires_second_person,
      requires_requester_repin = p_requires_requester_repin,
      expires_after_seconds = p_expires_after_seconds,
      threshold_context = p_threshold_context,
      active = p_active,
      edit_version = v_next_edit_version,
      updated_at = now()
    WHERE id = v_rule_id AND business_id = v_business_id;
  END IF;

  SELECT e.role INTO STRICT v_actor_role FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;
  v_after := jsonb_build_object(
    'actionType', p_action_type,
    'active', p_active,
    'threshold', p_threshold_context,
    'version', v_next_edit_version
  );
  INSERT INTO public.admin_audit_events (
    business_id, shop_id, actor_kind, actor_employee_id, actor_role,
    action_type, entity_type, entity_id, before_value, after_value
  ) VALUES (
    v_business_id, p_rule_shop_id, 'HUMAN', p_employee_id, v_actor_role,
    'approval.rule.upsert', 'approval_rule', v_rule_id::text, v_before, v_after
  );

  RETURN jsonb_build_object('ok', true,
    'ruleId', v_rule_id, 'editVersion', v_next_edit_version);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_admin_approval_rule_v1(
  uuid, uuid, uuid, uuid, text, text, text, boolean, boolean,
  integer, jsonb, boolean, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_admin_approval_rule_v1(
  uuid, uuid, uuid, uuid, text, text, text, boolean, boolean,
  integer, jsonb, boolean, bigint
) TO service_role;
