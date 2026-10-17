-- Safe business-scoped supplier lifecycle; historical POs keep supplier IDs/snapshots.
CREATE TABLE IF NOT EXISTS public.admin_supplier_management_commands (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  command_id text NOT NULL CHECK(length(command_id) BETWEEN 1 AND 160),
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id, command_id)
);
ALTER TABLE public.admin_supplier_management_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_supplier_management_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_supplier_management_commands TO service_role;

CREATE OR REPLACE FUNCTION public.manage_supplier_v1(
  p_employee_id uuid, p_shop_id uuid, p_supplier_id uuid,
  p_expected_version bigint, p_action text, p_payload jsonb, p_command_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_supplier public.suppliers%rowtype;
  v_existing public.admin_supplier_management_commands%rowtype;
  v_digest text;
  v_before jsonb;
  v_result jsonb;
  v_name text;
  v_contact text;
  v_phone text;
  v_email text;
  v_event text;
BEGIN
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );
  -- The supplier belongs to a business, not to an individual shop.
  IF NOT EXISTS (SELECT 1 FROM public.business_employees
    WHERE id = p_employee_id AND business_id = v_business_id
      AND active AND role IN ('OWNER', 'ADMIN')) THEN
    RETURN jsonb_build_object('ok',false,'code','permission_forbidden');
  END IF;
  IF p_action NOT IN ('supplier.update','supplier.archive','supplier.restore')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR nullif(btrim(coalesce(p_command_id,'')), '') IS NULL OR length(p_command_id) > 160 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_supplier_command');
  END IF;

  v_digest := md5(jsonb_build_object('supplierId',p_supplier_id,
    'version',p_expected_version,'action',p_action,'payload',p_payload)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'tux-supplier-management:' || v_business_id::text || ':' || p_command_id,0
  ));
  SELECT * INTO v_existing FROM public.admin_supplier_management_commands
    WHERE business_id=v_business_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_existing.request_digest <> v_digest THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict');
    END IF;
    RETURN v_existing.result || jsonb_build_object('idempotentReplay',true);
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers
    WHERE id=p_supplier_id AND business_id=v_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','supplier_not_found');
  END IF;
  IF v_supplier.version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('ok',false,'code','stale_version',
      'currentVersion',v_supplier.version);
  END IF;
  v_before := jsonb_build_object('name',v_supplier.name,'contactName',v_supplier.contact_name,
    'phone',v_supplier.phone,'email',v_supplier.email,'active',v_supplier.active,
    'version',v_supplier.version);

  IF p_action = 'supplier.update' THEN
    IF p_payload - 'name' - 'contactName' - 'phone' - 'email' <> '{}'::jsonb
       OR jsonb_typeof(p_payload->'name') <> 'string' THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_supplier_metadata');
    END IF;
    v_name := nullif(btrim(p_payload->>'name'),'');
    v_contact := nullif(btrim(coalesce(p_payload->>'contactName','')),'');
    v_phone := nullif(btrim(coalesce(p_payload->>'phone','')),'');
    v_email := nullif(btrim(coalesce(p_payload->>'email','')),'');
    IF v_name IS NULL OR length(v_name) > 160 OR length(coalesce(v_contact,'')) > 240
       OR length(coalesce(v_phone,'')) > 240 OR length(coalesce(v_email,'')) > 240
       OR (v_email IS NOT NULL AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_supplier_metadata');
    END IF;

    UPDATE public.suppliers SET name=v_name,contact_name=v_contact,
      phone=v_phone,email=v_email,version=version+1,updated_at=now()
      WHERE id=p_supplier_id RETURNING * INTO v_supplier;
    v_event := 'PURCHASING_SUPPLIER_UPDATED';
  ELSE
    IF p_payload <> '{}'::jsonb THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_supplier_lifecycle_payload');
    END IF;
    UPDATE public.suppliers SET active=(p_action='supplier.restore'),
      version=version+1,updated_at=now()
      WHERE id=p_supplier_id RETURNING * INTO v_supplier;
    v_event := CASE WHEN p_action='supplier.restore'
      THEN 'PURCHASING_SUPPLIER_RESTORED' ELSE 'PURCHASING_SUPPLIER_ARCHIVED' END;
  END IF;

  PERFORM public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_employee_id,v_event,'SUPPLIER',p_supplier_id::text,
    v_before,
    jsonb_build_object('name',v_supplier.name,'contactName',v_supplier.contact_name,
      'phone',v_supplier.phone,'email',v_supplier.email,'active',v_supplier.active,
      'version',v_supplier.version),
    NULL,NULL,NULL,'{}'::jsonb
  );
  v_result := jsonb_build_object('ok',true,'supplierId',p_supplier_id,
    'version',v_supplier.version,'active',v_supplier.active,'idempotentReplay',false);
  INSERT INTO public.admin_supplier_management_commands(
    business_id,command_id,request_digest,result
  ) VALUES(v_business_id,p_command_id,v_digest,v_result);
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'code','supplier_name_conflict');
END;
$function$;
REVOKE ALL ON FUNCTION public.manage_supplier_v1(uuid,uuid,uuid,bigint,text,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_supplier_v1(uuid,uuid,uuid,bigint,text,jsonb,text)
  TO service_role;
