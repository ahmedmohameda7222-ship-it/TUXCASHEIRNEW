-- Restore true business-default inheritance without resetting optimistic revision history.
CREATE TABLE IF NOT EXISTS public.shop_setting_override_revision_fences (
  business_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  setting_key text NOT NULL CHECK (setting_key ~ '^[A-Za-z][A-Za-z0-9_.-]*$'),
  last_version bigint NOT NULL CHECK (last_version > 0),
  PRIMARY KEY (shop_id, setting_key),
  FOREIGN KEY (business_id, shop_id)
    REFERENCES public.business_shops (business_id, shop_id) ON DELETE CASCADE
);
ALTER TABLE public.shop_setting_override_revision_fences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_setting_override_revision_fences FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_shop_setting_override_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_setting_key text,
  p_value_json jsonb,
  p_expected_version bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_current_version bigint;
  v_next_version bigint;
BEGIN
  IF NOT private.validate_admin_setting_value_v1(p_setting_key, p_value_json) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_setting');
  END IF;
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-setting-override:' || p_shop_id::text || ':' || p_setting_key, 0)
  );
  SELECT s.version INTO v_current_version
  FROM public.shop_setting_overrides s
  WHERE s.business_id = v_business_id AND s.shop_id = p_shop_id
    AND s.setting_key = p_setting_key FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS NULL OR p_expected_version <> v_current_version THEN
      RETURN jsonb_build_object('ok', false, 'code', 'stale_setting_version',
        'currentVersion', v_current_version);
    END IF;
    v_next_version := v_current_version + 1;
    UPDATE public.shop_setting_overrides SET
      value_json = p_value_json, version = v_next_version,
      updated_by_employee_id = p_employee_id, updated_at = now()
    WHERE business_id = v_business_id AND shop_id = p_shop_id AND setting_key = p_setting_key;
  ELSE
    IF p_expected_version IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'stale_setting_version', 'currentVersion', 0);
    END IF;
    SELECT COALESCE(f.last_version, 0) + 1 INTO v_next_version
    FROM public.shop_setting_override_revision_fences f
    WHERE f.business_id = v_business_id AND f.shop_id = p_shop_id
      AND f.setting_key = p_setting_key;
    v_next_version := COALESCE(v_next_version, 1);
    INSERT INTO public.shop_setting_overrides (
      business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
    ) VALUES (
      v_business_id, p_shop_id, p_setting_key, p_value_json, v_next_version, p_employee_id
    );
  END IF;
  INSERT INTO public.shop_setting_override_revision_fences (
    business_id, shop_id, setting_key, last_version
  ) VALUES (v_business_id, p_shop_id, p_setting_key, v_next_version)
  ON CONFLICT (shop_id, setting_key) DO UPDATE
    SET last_version = GREATEST(
      public.shop_setting_override_revision_fences.last_version, EXCLUDED.last_version
    );
  RETURN jsonb_build_object('ok', true, 'version', v_next_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_shop_setting_override_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_setting_key text,
  p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_current_version bigint;
  v_previous_value jsonb;
  v_actor_role text;
BEGIN
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_expected_version');
  END IF;
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-setting-override:' || p_shop_id::text || ':' || p_setting_key, 0)
  );
  SELECT s.version, s.value_json INTO v_current_version, v_previous_value
  FROM public.shop_setting_overrides s
  WHERE s.business_id = v_business_id AND s.shop_id = p_shop_id
    AND s.setting_key = p_setting_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_setting_version', 'currentVersion', 0);
  END IF;
  IF v_current_version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_setting_version',
      'currentVersion', v_current_version);
  END IF;
  INSERT INTO public.shop_setting_override_revision_fences (
    business_id, shop_id, setting_key, last_version
  ) VALUES (v_business_id, p_shop_id, p_setting_key, v_current_version)
  ON CONFLICT (shop_id, setting_key) DO UPDATE
    SET last_version = GREATEST(
      public.shop_setting_override_revision_fences.last_version, EXCLUDED.last_version
    );
  DELETE FROM public.shop_setting_overrides
  WHERE business_id = v_business_id AND shop_id = p_shop_id AND setting_key = p_setting_key;
  SELECT e.role INTO STRICT v_actor_role FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;
  INSERT INTO public.admin_audit_events (
    business_id, shop_id, actor_kind, actor_employee_id, actor_role,
    action_type, entity_type, entity_id, before_value, after_value
  ) VALUES (
    v_business_id, p_shop_id, 'HUMAN', p_employee_id, v_actor_role,
    'setting.override.restore_inherited', 'shop_setting_override', p_setting_key,
    jsonb_build_object('settingKey', p_setting_key, 'value', v_previous_value,
      'version', v_current_version),
    jsonb_build_object('settingKey', p_setting_key, 'source', 'business_default')
  );
  RETURN jsonb_build_object('ok', true, 'version', v_current_version);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_shop_setting_override_v1(
  uuid, uuid, text, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_shop_setting_override_v1(
  uuid, uuid, text, jsonb, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.restore_shop_setting_override_v1(
  uuid, uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_shop_setting_override_v1(
  uuid, uuid, text, bigint) TO service_role;
