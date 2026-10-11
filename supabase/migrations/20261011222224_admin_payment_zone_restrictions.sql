-- Stage a version-fenced payment-method delivery-zone restriction for the next Settings Publish.
-- Existing published snapshots and historical orders are immutable.
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

REVOKE ALL ON FUNCTION public.upsert_admin_payment_zone_rule_v1(
  uuid, uuid, uuid, uuid, boolean, boolean, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_admin_payment_zone_rule_v1(
  uuid, uuid, uuid, uuid, boolean, boolean, bigint
) TO service_role;
