-- Canonical shop order-type creation; no historical order snapshots are modified.
CREATE TABLE IF NOT EXISTS public.admin_order_type_create_commands (
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 160),
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(shop_id, command_id)
);
ALTER TABLE public.admin_order_type_create_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_order_type_create_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.admin_order_type_create_commands TO service_role;

CREATE OR REPLACE FUNCTION public.create_admin_order_type_v1(
  p_employee_id uuid,p_shop_id uuid,p_name text,p_behavior text,
  p_active boolean,p_sort_order integer,p_expected_settings_version bigint,
  p_command_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private'
AS $function$
DECLARE
  v_business_id uuid;
  v_current_settings_version bigint;
  v_digest text;
  v_previous public.admin_order_type_create_commands%rowtype;
  v_order_type public.order_types%rowtype;
  v_result jsonb;
BEGIN
  v_business_id:=private.assert_admin_settings_permission_v1(
    p_employee_id,p_shop_id,'settings.manage'
  );
  IF nullif(btrim(coalesce(p_name,'')),'') IS NULL OR length(p_name)>120
     OR p_behavior NOT IN ('TAKE_AWAY','DINE_IN','DELIVERY','OTHER')
     OR p_active IS NULL OR p_sort_order IS NULL OR p_sort_order<0
     OR p_expected_settings_version IS NULL OR p_expected_settings_version<0
     OR nullif(btrim(coalesce(p_command_id,'')),'') IS NULL
     OR length(p_command_id)>160 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_order_type_create');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_shops
    WHERE business_id=v_business_id AND shop_id=p_shop_id) THEN
    RETURN jsonb_build_object('ok',false,'code','shop_not_found');
  END IF;
  v_digest:=md5(jsonb_build_object('name',btrim(p_name),'behavior',p_behavior,
    'active',p_active,'sortOrder',p_sort_order,
    'settingsVersion',p_expected_settings_version)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_shop_id::text,0));
  SELECT * INTO v_previous FROM public.admin_order_type_create_commands
    WHERE shop_id=p_shop_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_previous.request_digest<>v_digest THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');END IF;
    RETURN v_previous.result||jsonb_build_object('idempotentReplay',true);
  END IF;
  SELECT coalesce(max(settings_version),0) INTO v_current_settings_version
    FROM public.shop_settings_versions WHERE shop_id=p_shop_id;
  IF v_current_settings_version<>p_expected_settings_version THEN
    RETURN jsonb_build_object('ok',false,'code','stale_settings_version',
      'currentVersion',v_current_settings_version);
  END IF;
  INSERT INTO public.order_types(id,shop_id,name,behavior,active,sort_order)
    VALUES(gen_random_uuid(),p_shop_id,btrim(p_name),p_behavior,p_active,p_sort_order)
    ON CONFLICT DO NOTHING RETURNING * INTO v_order_type;
  IF v_order_type.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','order_type_name_conflict');
  END IF;
  PERFORM public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_employee_id,
    'SETTINGS_ORDER_TYPE_CREATED','ORDER_TYPE',v_order_type.id::text,
    NULL,to_jsonb(v_order_type),NULL,NULL,NULL,'{}'::jsonb
  );
  v_result:=jsonb_build_object('ok',true,'orderTypeId',v_order_type.id,
    'editVersion',v_order_type.edit_version,'idempotentReplay',false);
  INSERT INTO public.admin_order_type_create_commands(shop_id,command_id,request_digest,result)
    VALUES(p_shop_id,p_command_id,v_digest,v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_order_type_v1(
 uuid,uuid,text,text,boolean,integer,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_order_type_v1(
 uuid,uuid,text,text,boolean,integer,bigint,text) TO service_role;
