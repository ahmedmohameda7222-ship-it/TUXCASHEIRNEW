-- Copy only explicitly previewed Checkout/Receipt values using the existing canonical setting write RPC.
-- Preview snapshots are verified in full before any write, under source/target locks.
CREATE OR REPLACE FUNCTION public.apply_admin_shop_settings_copy_v1(
  p_employee_id uuid,
  p_source_shop_id uuid,
  p_target_shop_id uuid,
  p_selected_domains text[],
  p_expected_source_settings_version bigint,
  p_expected_target_settings_version bigint,
  p_expected_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_target_business_id uuid;
  v_shop_id uuid;
  v_domain text;
  v_key text;
  v_keys text[] := ARRAY[]::text[];
  v_lock bigint;
  v_domain_count integer;
  v_distinct_domain_count integer;
  v_source_published bigint;
  v_target_published bigint;
  v_source_kind text;
  v_source_value jsonb;
  v_source_version bigint;
  v_target_kind text;
  v_target_value jsonb;
  v_target_override_version bigint;
  v_current_preview jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_result jsonb;
  v_updated_keys jsonb := '[]'::jsonb;
  v_actor_role text;
BEGIN
  IF p_employee_id IS NULL OR p_source_shop_id IS NULL OR p_target_shop_id IS NULL
     OR p_source_shop_id = p_target_shop_id
     OR p_expected_source_settings_version IS NULL OR p_expected_source_settings_version < 0
     OR p_expected_target_settings_version IS NULL OR p_expected_target_settings_version < 0
     OR p_expected_changes IS NULL OR jsonb_typeof(p_expected_changes) <> 'array'
     OR p_selected_domains IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_copy_request');
  END IF;

  SELECT count(*), count(DISTINCT domain)
  INTO v_domain_count, v_distinct_domain_count
  FROM unnest(p_selected_domains) AS selected(domain);
  IF v_domain_count < 1 OR v_domain_count > 2 OR v_distinct_domain_count <> v_domain_count
     OR EXISTS (
       SELECT 1 FROM unnest(p_selected_domains) AS selected(domain)
       WHERE domain NOT IN ('checkout', 'receipts') OR domain IS NULL
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_copy_domains');
  END IF;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_source_shop_id, 'settings.manage'
  );
  v_target_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_target_shop_id, 'settings.manage'
  );
  IF v_business_id IS NULL OR v_business_id <> v_target_business_id THEN
    RAISE EXCEPTION 'TUX_ADMIN_COPY_CROSS_BUSINESS_FORBIDDEN';
  END IF;

  FOREACH v_domain IN ARRAY p_selected_domains LOOP
    IF v_domain = 'checkout' THEN
      v_keys := array_cat(v_keys, ARRAY[
        'checkout.minimumOrderMinor',
        'checkout.serviceChargeBps',
        'checkout.taxBps',
        'checkout.allowDiscountStacking',
        'checkout.allowDeliveryFeeOverride',
        'checkout.requireCustomerPhone'
      ]);
    ELSIF v_domain = 'receipts' THEN
      v_keys := array_cat(v_keys, ARRAY[
        'receipt.orderPrefix',
        'receipt.footer',
        'receipt.sequenceStart'
      ]);
    END IF;
  END LOOP;

  -- Canonical publication locks first, in deterministic order.
  FOR v_shop_id IN
    SELECT s.shop_id
    FROM (VALUES (p_source_shop_id), (p_target_shop_id)) AS s(shop_id)
    ORDER BY s.shop_id::text
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('tux-admin-catalog:' || v_shop_id::text, 0)
    );
  END LOOP;

  -- Lock all override keys on both shops before inspecting values; deterministic order
  -- prevents source/target reversal deadlocks and races with single-row upserts.
  FOR v_lock IN
    SELECT DISTINCT hashtextextended(
      'tux-admin-setting-override:' || shops.shop_id::text || ':' || keys.setting_key, 0
    )
    FROM unnest(v_keys) AS keys(setting_key)
    CROSS JOIN (VALUES (p_source_shop_id), (p_target_shop_id)) AS shops(shop_id)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;

  -- Business-default writes use their own advisory-lock namespace, not the
  -- shop-level catalog lock. Lock every selected default key (including absent
  -- rows) so a concurrent default upsert cannot invalidate this preview after
  -- preflight but before the atomic target writes commit.
  FOR v_lock IN
    SELECT DISTINCT hashtextextended(
      'tux-admin-setting-default:' || v_business_id::text || ':' || keys.setting_key, 0
    )
    FROM unnest(v_keys) AS keys(setting_key)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock);
  END LOOP;

  SELECT COALESCE(MAX(s.settings_version), 0) INTO v_source_published
  FROM public.shop_settings_versions s
  WHERE s.business_id = v_business_id AND s.shop_id = p_source_shop_id;
  SELECT COALESCE(MAX(s.settings_version), 0) INTO v_target_published
  FROM public.shop_settings_versions s
  WHERE s.business_id = v_business_id AND s.shop_id = p_target_shop_id;

  IF v_source_published <> p_expected_source_settings_version
     OR v_target_published <> p_expected_target_settings_version THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'stale_settings_version',
      'sourceCurrentVersion', v_source_published,
      'targetCurrentVersion', v_target_published
    );
  END IF;

  -- Preflight EVERY source and target setting (including no-op rows) before writes.
  FOREACH v_key IN ARRAY v_keys LOOP
    v_source_value := NULL;
    v_source_version := NULL;
    v_source_kind := 'unset';
    SELECT o.value_json, o.version INTO v_source_value, v_source_version
    FROM public.shop_setting_overrides o
    WHERE o.business_id = v_business_id AND o.shop_id = p_source_shop_id
      AND o.setting_key = v_key;
    IF FOUND THEN
      v_source_kind := 'shop';
    ELSE
      SELECT d.value_json, d.version INTO v_source_value, v_source_version
      FROM public.business_setting_defaults d
      WHERE d.business_id = v_business_id AND d.setting_key = v_key;
      IF FOUND THEN v_source_kind := 'business'; END IF;
    END IF;
    IF v_source_kind = 'unset' THEN CONTINUE; END IF;

    v_target_value := NULL;
    v_target_override_version := NULL;
    v_target_kind := 'unset';
    SELECT o.value_json, o.version INTO v_target_value, v_target_override_version
    FROM public.shop_setting_overrides o
    WHERE o.business_id = v_business_id AND o.shop_id = p_target_shop_id
      AND o.setting_key = v_key;
    IF FOUND THEN
      v_target_kind := 'shop';
    ELSE
      SELECT d.value_json INTO v_target_value
      FROM public.business_setting_defaults d
      WHERE d.business_id = v_business_id AND d.setting_key = v_key;
      IF FOUND THEN v_target_kind := 'business'; END IF;
    END IF;

    v_current_preview := v_current_preview || jsonb_build_array(
      jsonb_build_object(
        'settingKey', v_key,
        'sourceValue', v_source_value,
        'source', v_source_kind,
        'sourceExpectedVersion', v_source_version,
        'targetValue', v_target_value,
        'targetSource', v_target_kind,
        'targetExpectedVersion', v_target_override_version,
        'wouldChange', v_source_value IS DISTINCT FROM v_target_value
      )
    );
  END LOOP;

  IF v_current_preview <> p_expected_changes THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_copy_preview');
  END IF;

  -- All snapshots match under the same locks. Any unexpected failure raises to
  -- roll back the entire transaction instead of returning partial success.
  SELECT e.role INTO STRICT v_actor_role
  FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_current_preview) AS e(value)
  LOOP
    IF (v_entry ->> 'wouldChange')::boolean IS NOT TRUE THEN CONTINUE; END IF;
    v_key := v_entry ->> 'settingKey';

    v_result := public.upsert_shop_setting_override_v1(
      p_employee_id, p_target_shop_id, v_key,
      v_entry -> 'sourceValue',
      (v_entry ->> 'targetExpectedVersion')::bigint
    );
    IF v_result ->> 'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'TUX_ADMIN_COPY_ATOMIC_WRITE_FAILED:%',
        COALESCE(v_result ->> 'code', 'unknown');
    END IF;

    INSERT INTO public.admin_audit_events(
      business_id, shop_id, actor_kind, actor_employee_id, actor_role,
      action_type, entity_type, entity_id, before_value, after_value
    ) VALUES (
      v_business_id, p_target_shop_id, 'HUMAN', p_employee_id, v_actor_role,
      'shop.settings.copy', 'shop_setting_override', v_key,
      jsonb_build_object(
        'sourceShopId', p_source_shop_id, 'targetSource', v_entry -> 'targetSource',
        'value', v_entry -> 'targetValue',
        'version', v_entry -> 'targetExpectedVersion'
      ),
      jsonb_build_object(
        'sourceShopId', p_source_shop_id, 'value', v_entry -> 'sourceValue',
        'version', v_result -> 'version', 'published', false
      )
    );
    v_updated_keys := v_updated_keys || jsonb_build_array(v_key);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'updatedKeys', v_updated_keys, 'publishRequired', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_admin_shop_settings_copy_v1(
  uuid, uuid, uuid, text[], bigint, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_admin_shop_settings_copy_v1(
  uuid, uuid, uuid, text[], bigint, bigint, jsonb
) TO service_role;
