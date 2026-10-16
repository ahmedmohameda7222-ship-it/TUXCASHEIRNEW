-- PR #119 Plans 2/3: exact-CAS, optional second-person approval
-- for payment-method edits, not create or payment-zone mutations.
-- Existing finalized payments/snapshots stay immutable. No operational DML.
create table if not exists private.admin_payment_method_update_approval_receipts (
  approval_request_id uuid primary key references public.admin_approval_requests(id),
  business_id uuid not null,
  shop_id uuid not null,
  payment_method_id uuid not null,
  approval_command_id uuid not null,
  expected_edit_version bigint not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (business_id,shop_id,payment_method_id,approval_command_id)
);
alter table private.admin_payment_method_update_approval_receipts enable row level security;
revoke all on private.admin_payment_method_update_approval_receipts
  from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.update_admin_payment_method_v1(p_employee_id uuid, p_shop_id uuid, p_payment_method_id uuid, p_display_name text, p_active boolean, p_sort_order integer, p_channel text, p_requires_reference boolean, p_manual_confirmation_required boolean, p_refund_allowed boolean, p_expected_settings_version bigint, p_expected_edit_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_edit_version bigint;
  v_current_refund_allowed boolean;
  v_next_edit_version bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_payment_method_id is null
     or nullif(btrim(p_display_name), '') is null
     or p_active is null or p_sort_order is null
     or p_channel not in ('POS', 'ONLINE', 'BOTH')
     or p_requires_reference is null or p_manual_confirmation_required is null
     or p_refund_allowed is null or p_expected_settings_version is null or p_expected_settings_version < 0
     or p_expected_edit_version is null or p_expected_edit_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payment_method_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(p_employee_id, p_shop_id, 'settings.manage');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  -- Active rules and already-open requests must never be bypassed by direct
  -- service RPC calls or policy deactivation after a request is created.
  if (
    exists (
      select 1 from public.admin_approval_rules r
      where r.business_id=v_business_id
        and r.action_type='SETTINGS_PAYMENT_METHOD_CHANGE'
        and r.active and (r.shop_id=p_shop_id or r.shop_id is null)
    )
    or exists (
      select 1 from public.admin_approval_requests r
      where r.business_id=v_business_id and r.shop_id=p_shop_id
        and r.action_type='SETTINGS_PAYMENT_METHOD_CHANGE'
        and r.status in ('PENDING','APPROVED','EXECUTING')
        and r.command_payload->>'paymentMethodId'=p_payment_method_id::text
    )
  ) and not exists (
    select 1 from public.admin_approval_requests a
    where a.id=nullif(current_setting('tux.approved_payment_method_request_id',true),'')::uuid
      and a.business_id=v_business_id and a.shop_id=p_shop_id
      and a.action_type='SETTINGS_PAYMENT_METHOD_CHANGE'
      and a.requester_employee_id=p_employee_id
      and a.approver_employee_id is not null
      and a.approver_employee_id<>p_employee_id
      and a.status='EXECUTING'
      and a.command_payload=jsonb_build_object(
        'shopId',p_shop_id,'paymentMethodId',p_payment_method_id,
        'displayName',btrim(p_display_name),'active',p_active,
        'sortOrder',p_sort_order,'channel',p_channel,
        'requiresReference',p_requires_reference,
        'manualConfirmationRequired',p_manual_confirmation_required,
        'refundAllowed',p_refund_allowed,
        'expectedSettingsVersion',p_expected_settings_version,
        'expectedEditVersion',p_expected_edit_version)
  ) then
    return jsonb_build_object('ok',false,'code','payment_method_approval_required');
  end if;

  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0) into v_current_settings_version
  from public.shop_settings_versions s where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  select p.edit_version, p.refund_allowed
    into v_current_edit_version, v_current_refund_allowed
  from public.payment_methods p
  where p.id = p_payment_method_id and p.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_method_not_found');
  end if;
  if v_current_edit_version <> p_expected_edit_version then
    return jsonb_build_object('ok', false, 'code', 'stale_edit_version', 'currentVersion', v_current_edit_version);
  end if;

  v_next_edit_version := v_current_edit_version + 1;
  update public.payment_methods
  set display_name = btrim(p_display_name),
      active = p_active,
      sort_order = p_sort_order,
      channel = p_channel,
      requires_reference = p_requires_reference,
      manual_confirmation_required = p_manual_confirmation_required,
      refund_allowed = p_refund_allowed,
      edit_version = v_next_edit_version,
      updated_at = now()
  where id = p_payment_method_id and shop_id = p_shop_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'SETTINGS_PAYMENT_METHOD_UPDATED', 'PAYMENT_METHOD', p_payment_method_id::text,
    jsonb_build_object('refundAllowed',v_current_refund_allowed,'editVersion',v_current_edit_version),
    jsonb_build_object('refundAllowed',p_refund_allowed,'editVersion',v_next_edit_version),
    null,null,null,'{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'editVersion', v_next_edit_version);
end;
$function$
;

create or replace function public.execute_approved_admin_payment_method_update_v1(
  p_approval_request_id uuid, p_business_id uuid, p_shop_id uuid,
  p_requester_employee_id uuid, p_approver_employee_id uuid,
  p_payment_method_id uuid, p_display_name text, p_active boolean,
  p_sort_order integer, p_channel text, p_requires_reference boolean,
  p_manual_confirmation_required boolean, p_refund_allowed boolean,
  p_expected_settings_version bigint, p_expected_edit_version bigint,
  p_command_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $approved_payment_update$
declare
  v_approval public.admin_approval_requests%rowtype;
  v_receipt private.admin_payment_method_update_approval_receipts%rowtype;
  v_expected jsonb;
  v_result jsonb;
  v_requester_business uuid;
  v_approver_business uuid;
begin
  if p_approval_request_id is null or p_business_id is null
    or p_shop_id is null or p_requester_employee_id is null
    or p_approver_employee_id is null or p_payment_method_id is null
    or p_command_id is null or nullif(btrim(p_display_name),'') is null
    or p_active is null or p_sort_order is null or p_sort_order<0
    or p_channel not in ('POS','ONLINE','BOTH')
    or p_requires_reference is null or p_manual_confirmation_required is null
    or p_refund_allowed is null or p_expected_settings_version is null
    or p_expected_settings_version<0 or p_expected_edit_version is null
    or p_expected_edit_version<1 then
    return jsonb_build_object('ok',false,'code','invalid_approved_payment_update');
  end if;
  select * into v_approval from public.admin_approval_requests
   where id=p_approval_request_id and business_id=p_business_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','approval_request_not_found');
  end if;
  v_expected:=jsonb_build_object(
    'shopId',p_shop_id,'paymentMethodId',p_payment_method_id,
    'displayName',btrim(p_display_name),'active',p_active,
    'sortOrder',p_sort_order,'channel',p_channel,
    'requiresReference',p_requires_reference,
    'manualConfirmationRequired',p_manual_confirmation_required,
    'refundAllowed',p_refund_allowed,
    'expectedSettingsVersion',p_expected_settings_version,
    'expectedEditVersion',p_expected_edit_version);
  if v_approval.action_type<>'SETTINGS_PAYMENT_METHOD_CHANGE'
    or v_approval.shop_id is distinct from p_shop_id
    or v_approval.requester_employee_id<>p_requester_employee_id
    or v_approval.approver_employee_id is distinct from p_approver_employee_id
    or v_approval.requester_employee_id=p_approver_employee_id
    or v_approval.required_approver_permission<>'approvals.review'
    or not v_approval.requires_second_person
    or v_approval.command_id<>p_command_id
    or v_approval.command_payload<>v_expected
    or v_approval.status not in ('EXECUTING','EXECUTED') then
    return jsonb_build_object('ok',false,'code','approval_payment_payload_or_state_mismatch');
  end if;
  v_requester_business:=private.assert_admin_settings_permission_v1(
    p_requester_employee_id,p_shop_id,'settings.manage');
  v_approver_business:=private.assert_admin_settings_permission_v1(
    p_approver_employee_id,p_shop_id,'approvals.review');
  if v_requester_business is distinct from p_business_id
    or v_approver_business is distinct from p_business_id then
    return jsonb_build_object('ok',false,'code','approval_payment_business_mismatch');
  end if;

  select * into v_receipt
   from private.admin_payment_method_update_approval_receipts
   where approval_request_id=p_approval_request_id for update;
  if found then
    if v_receipt.business_id<>p_business_id
      or v_receipt.shop_id<>p_shop_id
      or v_receipt.payment_method_id<>p_payment_method_id
      or v_receipt.approval_command_id<>p_command_id
      or v_receipt.expected_edit_version<>p_expected_edit_version then
      return jsonb_build_object('ok',false,'code','approval_payment_receipt_conflict');
    end if;
    return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
  end if;
  if v_approval.status<>'EXECUTING' then
    return jsonb_build_object('ok',false,'code','approval_payment_not_claimed');
  end if;

  perform set_config('tux.approved_payment_method_request_id',p_approval_request_id::text,true);
  v_result:=public.update_admin_payment_method_v1(
    p_requester_employee_id,p_shop_id,p_payment_method_id,p_display_name,
    p_active,p_sort_order,p_channel,p_requires_reference,
    p_manual_confirmation_required,p_refund_allowed,
    p_expected_settings_version,p_expected_edit_version);
  perform set_config('tux.approved_payment_method_request_id','',true);
  if v_result->>'ok' is distinct from 'true' then return v_result; end if;
  insert into private.admin_payment_method_update_approval_receipts (
    approval_request_id,business_id,shop_id,payment_method_id,
    approval_command_id,expected_edit_version,result_json
  ) values (
    p_approval_request_id,p_business_id,p_shop_id,p_payment_method_id,
    p_command_id,p_expected_edit_version,v_result
  );
  perform public.append_admin_audit_event_v1(
    p_business_id,p_shop_id,p_approver_employee_id,
    'SETTINGS_PAYMENT_METHOD_APPROVED_APPLIED','PAYMENT_METHOD',p_payment_method_id::text,
    jsonb_build_object('editVersion',p_expected_edit_version),
    jsonb_build_object('editVersion',(v_result->>'editVersion')::bigint),
    null,p_approval_request_id,null,
    jsonb_build_object('commandId',p_command_id));
  return v_result;
end;
$approved_payment_update$;

revoke all on function public.execute_approved_admin_payment_method_update_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,
  boolean,bigint,bigint,uuid) from public,anon,authenticated;
grant execute on function public.execute_approved_admin_payment_method_update_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,
  boolean,bigint,bigint,uuid) to service_role;

revoke all on function public.update_admin_payment_method_v1(
  uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,
  boolean,bigint,bigint) from public,anon,authenticated;
grant execute on function public.update_admin_payment_method_v1(
  uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,
  boolean,bigint,bigint) to service_role;
