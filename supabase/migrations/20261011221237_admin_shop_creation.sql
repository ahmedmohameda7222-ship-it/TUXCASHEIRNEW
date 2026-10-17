-- Create a new canonical shop for the authorized actor's business only.
-- New shops start closed; no historical orders, inventory, catalog or configuration is copied.
CREATE TABLE IF NOT EXISTS public.admin_shop_create_commands (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  actor_employee_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(btrim(command_id)) BETWEEN 1 AND 160),
  request_payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, actor_employee_id, command_id),
  FOREIGN KEY (business_id, actor_employee_id)
    REFERENCES public.business_employees(business_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.admin_shop_create_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_shop_create_commands FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_admin_shop_v1(
  p_employee_id uuid,
  p_context_shop_id uuid,
  p_name text,
  p_address_text text,
  p_contact_phone text,
  p_command_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private'
AS $function$
DECLARE
  v_business_id uuid;
  v_name text;
  v_payload jsonb;
  v_previous public.admin_shop_create_commands%ROWTYPE;
  v_shop_id uuid;
  v_result jsonb;
BEGIN
  -- A known, already-authorized shop establishes the actor's business; never trust a client business ID.
  v_business_id := private.assert_admin_business_settings_permission_v1(
    p_employee_id, p_context_shop_id, 'shops.manage'
  );
  v_name := btrim(coalesce(p_name,''));
  IF v_business_id IS NULL OR length(v_name) NOT BETWEEN 1 AND 120
    OR (p_address_text IS NOT NULL AND length(p_address_text) > 500)
    OR (p_contact_phone IS NOT NULL AND length(p_contact_phone) > 80)
    OR nullif(btrim(coalesce(p_command_id,'')),'') IS NULL
    OR length(p_command_id) > 160
  THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_shop_create');
  END IF;

  v_payload := jsonb_build_object(
    'contextShopId',p_context_shop_id,
    'name',v_name,
    'address',nullif(btrim(p_address_text),''),
    'contactPhone',nullif(btrim(p_contact_phone),'')
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'tux-admin-shop-create:' || v_business_id::text || ':' ||
    p_employee_id::text || ':' || p_command_id, 0
  ));
  SELECT * INTO v_previous
  FROM public.admin_shop_create_commands c
  WHERE c.business_id=v_business_id
    AND c.actor_employee_id=p_employee_id AND c.command_id=p_command_id;
  IF FOUND THEN
    IF v_previous.request_payload <> v_payload THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.business_shops bs
      WHERE bs.business_id=v_business_id
        AND bs.shop_id=(v_previous.result ->> 'shopId')::uuid
    ) THEN
      RETURN jsonb_build_object('ok',false,'code','shop_already_removed');
    END IF;
    RETURN v_previous.result || jsonb_build_object('idempotentReplay',true);
  END IF;

  v_shop_id := gen_random_uuid();
  INSERT INTO public.shops (
    id,name,lifecycle_state,active,timezone,
    address_text,contact_phone,temporary_closed,online_orders_paused
  ) VALUES (
    v_shop_id,v_name,'ACTIVE',true,'Africa/Cairo',
    nullif(btrim(p_address_text),''),nullif(btrim(p_contact_phone),''),
    true,true
  );
  INSERT INTO public.business_shops (business_id,shop_id)
  VALUES (v_business_id,v_shop_id);

  -- The first authorized settings publish builds the initial canonical v1 configuration.
  -- No implicit copy from p_context_shop_id and no staff membership duplication.
  PERFORM public.append_admin_audit_event_v1(
    v_business_id,v_shop_id,p_employee_id,
    'SHOP_CREATED','SHOP',v_shop_id::text,NULL,
    jsonb_build_object(
      'name',v_name,'lifecycleState','ACTIVE',
      'temporaryClosed',true,'onlineOrdersPaused',true,
      'timezone','Africa/Cairo'
    ),
    NULL,NULL,NULL,'{}'::jsonb
  );

  v_result := jsonb_build_object(
    'ok',true,'shopId',v_shop_id,'idempotentReplay',false
  );
  INSERT INTO public.admin_shop_create_commands (
    business_id,actor_employee_id,command_id,request_payload,result
  ) VALUES (v_business_id,p_employee_id,p_command_id,v_payload,v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_admin_shop_v1(uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_shop_v1(uuid,uuid,text,text,text,text)
  TO service_role;
