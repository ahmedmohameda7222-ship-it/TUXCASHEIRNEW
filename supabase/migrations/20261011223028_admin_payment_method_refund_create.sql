-- The existing v1 RPC remains compatibility-safe: it creates refund-eligible methods.
-- New v2 makes refundAllowed an explicit, server-validated atomic creation field.
-- The trusted refund path enforces immutable eligibility on new payments.
CREATE OR REPLACE FUNCTION public.create_admin_payment_method_v2(p_employee_id uuid, p_shop_id uuid, p_display_name text, p_logic_type text, p_active boolean, p_sort_order integer, p_channel text, p_requires_reference boolean, p_manual_confirmation_required boolean, p_refund_allowed boolean, p_expected_settings_version bigint, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_payload jsonb;
  v_previous public.admin_payment_method_create_commands%ROWTYPE;
  v_current_settings_version bigint;
  v_method public.payment_methods%ROWTYPE;
  v_result jsonb;
BEGIN
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  IF nullif(btrim(coalesce(p_display_name, '')), '') IS NULL
    OR length(p_display_name) > 120
    OR p_logic_type IS NULL OR p_logic_type NOT IN ('CASH','CARD','DIGITAL','OTHER')
    OR p_active IS NULL OR p_sort_order IS NULL OR p_sort_order < 0
    OR p_channel IS NULL OR p_channel NOT IN ('POS','ONLINE','BOTH')
    OR p_requires_reference IS NULL OR p_manual_confirmation_required IS NULL
    OR p_refund_allowed IS NULL
    OR p_expected_settings_version IS NULL OR p_expected_settings_version < 0
    OR nullif(btrim(coalesce(p_command_id, '')), '') IS NULL
    OR length(p_command_id) > 160 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_payment_method_create');
  END IF;

  v_payload := jsonb_build_object(
    'displayName',btrim(p_display_name),'logicType',p_logic_type,
    'active',p_active,'sortOrder',p_sort_order,'channel',p_channel,
    'requiresReference',p_requires_reference,
    'manualConfirmationRequired',p_manual_confirmation_required,
    'refundAllowed',p_refund_allowed,
    'expectedSettingsVersion',p_expected_settings_version
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'tux-admin-catalog:' || p_shop_id::text, 0
  ));
  SELECT * INTO v_previous FROM public.admin_payment_method_create_commands
  WHERE shop_id=p_shop_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_previous.request_payload <> v_payload THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN v_previous.result || jsonb_build_object('idempotentReplay',true);
  END IF;

  SELECT coalesce(max(settings_version),0) INTO v_current_settings_version
    FROM public.shop_settings_versions WHERE shop_id=p_shop_id;
  IF v_current_settings_version <> p_expected_settings_version THEN
    RETURN jsonb_build_object('ok',false,'code','stale_settings_version',
      'currentVersion',v_current_settings_version);
  END IF;

  -- Refund restrictions are not editable until the trusted refund posting path enforces them.
  -- Reconciliation and integration authority remain server-owned at creation.
  INSERT INTO public.payment_methods(
    id,shop_id,display_name,logic_type,requires_reconciliation,
    active,sort_order,channel,requires_reference,
    manual_confirmation_required,refund_allowed,integration_reference
  ) VALUES(
    gen_random_uuid(),p_shop_id,btrim(p_display_name),p_logic_type,true,
    p_active,p_sort_order,p_channel,p_requires_reference,
    p_manual_confirmation_required,p_refund_allowed,NULL
  ) ON CONFLICT DO NOTHING RETURNING * INTO v_method;
  IF v_method.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','payment_method_name_conflict');
  END IF;

  PERFORM public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_employee_id,
    'SETTINGS_PAYMENT_METHOD_CREATED','PAYMENT_METHOD',v_method.id::text,
    NULL,to_jsonb(v_method),NULL,NULL,NULL,'{}'::jsonb
  );
  v_result := jsonb_build_object(
    'ok',true,'paymentMethodId',v_method.id,
    'editVersion',v_method.edit_version,'idempotentReplay',false
  );
  INSERT INTO public.admin_payment_method_create_commands(
    shop_id,command_id,request_payload,result
  ) VALUES(p_shop_id,p_command_id,v_payload,v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_payment_method_v2(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,boolean,bigint,text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_payment_method_v2(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,boolean,bigint,text
) TO service_role;
