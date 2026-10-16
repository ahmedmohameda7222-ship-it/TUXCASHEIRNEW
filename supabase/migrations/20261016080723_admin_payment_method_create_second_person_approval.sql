-- PR #119: separately governed payment-method creation (not edit or zone).
-- Forward-only RPC hardening; existing payment methods and historical payment
-- snapshots remain unchanged. No operational DML in this migration.
create table if not exists private.admin_payment_method_create_approval_receipts (
  approval_request_id uuid primary key references public.admin_approval_requests(id),
  business_id uuid not null,
  shop_id uuid not null,
  approval_command_id uuid not null,
  original_command_id text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (business_id,shop_id,approval_command_id)
);
alter table private.admin_payment_method_create_approval_receipts enable row level security;
revoke all on private.admin_payment_method_create_approval_receipts
  from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_admin_payment_method_v1(p_employee_id uuid, p_shop_id uuid, p_display_name text, p_logic_type text, p_active boolean, p_sort_order integer, p_channel text, p_requires_reference boolean, p_manual_confirmation_required boolean, p_expected_settings_version bigint, p_command_id text)
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


  -- The legacy creator is never an approved-command executor.
  -- Preserve historical command replay but block new creations while approval
  -- rules are configured or any CREATE approval remains open for this shop.
  IF EXISTS (
    SELECT 1 FROM public.admin_approval_rules r
    WHERE r.business_id=v_business_id
      AND r.action_type='SETTINGS_PAYMENT_METHOD_CREATE'
      AND r.active AND (r.shop_id=p_shop_id OR r.shop_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.admin_approval_requests a
    WHERE a.business_id=v_business_id AND a.shop_id=p_shop_id
      AND a.action_type='SETTINGS_PAYMENT_METHOD_CREATE'
      AND a.status IN ('PENDING','APPROVED','EXECUTING')
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','payment_method_create_approval_required');
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
    p_manual_confirmation_required,true,NULL
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
$function$
;

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


  -- SQL writes cannot bypass active policies or mutate while a request is open.
  -- Only the transaction-scoped exact APPROVED/EXECUTING worker command is exempt.
  IF (
    EXISTS (
      SELECT 1 FROM public.admin_approval_rules r
      WHERE r.business_id=v_business_id
        AND r.action_type='SETTINGS_PAYMENT_METHOD_CREATE'
        AND r.active AND (r.shop_id=p_shop_id OR r.shop_id IS NULL)
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_approval_requests a
      WHERE a.business_id=v_business_id AND a.shop_id=p_shop_id
        AND a.action_type='SETTINGS_PAYMENT_METHOD_CREATE'
        AND a.status IN ('PENDING','APPROVED','EXECUTING')
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.admin_approval_requests a
    WHERE a.id=nullif(
      current_setting('tux.approved_payment_create_request_id',true),''
    )::uuid
      AND a.business_id=v_business_id AND a.shop_id=p_shop_id
      AND a.action_type='SETTINGS_PAYMENT_METHOD_CREATE'
      AND a.requester_employee_id=p_employee_id
      AND a.approver_employee_id IS NOT NULL
      AND a.approver_employee_id<>p_employee_id
      AND a.status='EXECUTING'
      AND a.command_payload=jsonb_build_object(
        'shopId',p_shop_id,'commandId',p_command_id,
        'displayName',btrim(p_display_name),'logicType',p_logic_type,
        'active',p_active,'sortOrder',p_sort_order,'channel',p_channel,
        'requiresReference',p_requires_reference,
        'manualConfirmationRequired',p_manual_confirmation_required,
        'refundAllowed',p_refund_allowed,
        'expectedSettingsVersion',p_expected_settings_version
      )
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','payment_method_create_approval_required');
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
$function$
;

create or replace function public.execute_approved_admin_payment_method_create_v1(
  p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
  p_requester_employee_id uuid,p_approver_employee_id uuid,
  p_original_command_id text,p_display_name text,p_logic_type text,
  p_active boolean,p_sort_order integer,p_channel text,
  p_requires_reference boolean,p_manual_confirmation_required boolean,
  p_refund_allowed boolean,p_expected_settings_version bigint,
  p_approval_command_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $approved_payment_create$
declare
  v_approval public.admin_approval_requests%rowtype;
  v_receipt private.admin_payment_method_create_approval_receipts%rowtype;
  v_expected jsonb;
  v_result jsonb;
  v_requester_business uuid;
  v_approver_business uuid;
begin
  if p_approval_request_id is null or p_business_id is null
    or p_shop_id is null or p_requester_employee_id is null
    or p_approver_employee_id is null or p_approval_command_id is null
    or nullif(btrim(coalesce(p_original_command_id,'')),'') is null
    or length(p_original_command_id)>160
    or nullif(btrim(coalesce(p_display_name,'')),'') is null
    or length(p_display_name)>120
    or p_logic_type not in ('CASH','CARD','DIGITAL','OTHER')
    or p_channel not in ('POS','ONLINE','BOTH')
    or p_active is null or p_sort_order is null or p_sort_order<0
    or p_requires_reference is null or p_manual_confirmation_required is null
    or p_refund_allowed is null or p_expected_settings_version is null
    or p_expected_settings_version<0 then
    return jsonb_build_object('ok',false,'code','invalid_approved_payment_create');
  end if;
  select * into v_approval from public.admin_approval_requests
   where id=p_approval_request_id and business_id=p_business_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','approval_request_not_found');
  end if;
  v_expected:=jsonb_build_object(
    'shopId',p_shop_id,'commandId',p_original_command_id,
    'displayName',btrim(p_display_name),'logicType',p_logic_type,
    'active',p_active,'sortOrder',p_sort_order,'channel',p_channel,
    'requiresReference',p_requires_reference,
    'manualConfirmationRequired',p_manual_confirmation_required,
    'refundAllowed',p_refund_allowed,
    'expectedSettingsVersion',p_expected_settings_version);
  if v_approval.action_type<>'SETTINGS_PAYMENT_METHOD_CREATE'
    or v_approval.shop_id is distinct from p_shop_id
    or v_approval.requester_employee_id<>p_requester_employee_id
    or v_approval.approver_employee_id is distinct from p_approver_employee_id
    or v_approval.requester_employee_id=p_approver_employee_id
    or v_approval.required_approver_permission<>'approvals.review'
    or not v_approval.requires_second_person
    or v_approval.command_id<>p_approval_command_id
    or v_approval.command_payload<>v_expected
    or v_approval.status not in ('EXECUTING','EXECUTED') then
    return jsonb_build_object('ok',false,'code','approval_payment_create_payload_or_state_mismatch');
  end if;
  v_requester_business:=private.assert_admin_settings_permission_v1(
    p_requester_employee_id,p_shop_id,'settings.manage');
  v_approver_business:=private.assert_admin_settings_permission_v1(
    p_approver_employee_id,p_shop_id,'approvals.review');
  if v_requester_business is distinct from p_business_id
    or v_approver_business is distinct from p_business_id then
    return jsonb_build_object('ok',false,'code','approval_payment_create_business_mismatch');
  end if;
  select * into v_receipt
    from private.admin_payment_method_create_approval_receipts
    where approval_request_id=p_approval_request_id for update;
  if found then
    if v_receipt.business_id<>p_business_id
      or v_receipt.shop_id<>p_shop_id
      or v_receipt.original_command_id<>p_original_command_id
      or v_receipt.approval_command_id<>p_approval_command_id then
      return jsonb_build_object('ok',false,'code','approval_payment_create_receipt_conflict');
    end if;
    return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
  end if;
  if v_approval.status<>'EXECUTING' then
    return jsonb_build_object('ok',false,'code','approval_payment_create_not_claimed');
  end if;
  perform set_config('tux.approved_payment_create_request_id',
    p_approval_request_id::text,true);
  v_result:=public.create_admin_payment_method_v2(
    p_requester_employee_id,p_shop_id,p_display_name,p_logic_type,
    p_active,p_sort_order,p_channel,p_requires_reference,
    p_manual_confirmation_required,p_refund_allowed,
    p_expected_settings_version,p_original_command_id);
  perform set_config('tux.approved_payment_create_request_id','',true);
  if v_result->>'ok' is distinct from 'true' then return v_result; end if;
  insert into private.admin_payment_method_create_approval_receipts(
    approval_request_id,business_id,shop_id,approval_command_id,
    original_command_id,result_json
  ) values (
    p_approval_request_id,p_business_id,p_shop_id,p_approval_command_id,
    p_original_command_id,v_result
  );
  perform public.append_admin_audit_event_v1(
    p_business_id,p_shop_id,p_approver_employee_id,
    'SETTINGS_PAYMENT_METHOD_APPROVED_CREATED','PAYMENT_METHOD',
    v_result->>'paymentMethodId',
    null,jsonb_build_object('paymentMethodId',v_result->>'paymentMethodId'),
    null,p_approval_request_id,null,
    jsonb_build_object('originalCommandId',p_original_command_id,
      'approvalCommandId',p_approval_command_id));
  return v_result;
end;
$approved_payment_create$;

revoke all on function public.create_admin_payment_method_v1(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,bigint,text)
  from public,anon,authenticated;
grant execute on function public.create_admin_payment_method_v1(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,bigint,text)
  to service_role;
revoke all on function public.create_admin_payment_method_v2(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,boolean,bigint,text)
  from public,anon,authenticated;
grant execute on function public.create_admin_payment_method_v2(
  uuid,uuid,text,text,boolean,integer,text,boolean,boolean,boolean,bigint,text)
  to service_role;
revoke all on function public.execute_approved_admin_payment_method_create_v1(
  uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,integer,text,
  boolean,boolean,boolean,bigint,uuid) from public,anon,authenticated;
grant execute on function public.execute_approved_admin_payment_method_create_v1(
  uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,integer,text,
  boolean,boolean,boolean,bigint,uuid) to service_role;
