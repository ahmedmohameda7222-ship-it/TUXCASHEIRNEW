-- PR #119 Plans 2/3: optional approval on effective checkout Tax/Service
-- publication. Draft settings may be staged, but a changed effective rate
-- cannot be published without an EXECUTING distinct-person approved command.
-- Hash binds the complete exact candidate snapshot, not just a client value.
-- No operational DML or historical configuration rewrite in this migration.
create table if not exists private.admin_checkout_rate_publish_approval_receipts (
 approval_request_id uuid primary key references public.admin_approval_requests(id),
 business_id uuid not null,
 shop_id uuid not null,
 command_id uuid not null,
 expected_settings_version bigint not null,
 payload_fingerprint text not null,
 result_json jsonb not null,
 created_at timestamptz not null default now(),
 unique (business_id,shop_id,command_id)
);
alter table private.admin_checkout_rate_publish_approval_receipts enable row level security;
revoke all on private.admin_checkout_rate_publish_approval_receipts
 from public,anon,authenticated,service_role;

create or replace function public.preview_admin_checkout_rate_publish_v1(
 p_employee_id uuid,p_shop_id uuid,p_expected_settings_version bigint
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $rate_preview$
declare
 v_business_id uuid;
 v_current_version bigint;
 v_payload jsonb;
 v_prev_values jsonb;
 v_rate_change boolean;
begin
 if p_employee_id is null or p_shop_id is null
   or p_expected_settings_version is null or p_expected_settings_version<0 then
   return jsonb_build_object('ok',false,'code','invalid_checkout_publish_preview');
 end if;
 v_business_id:=private.assert_admin_settings_permission_v1(
   p_employee_id,p_shop_id,'settings.manage');
 perform pg_advisory_xact_lock(
   hashtextextended('tux-admin-catalog:'||p_shop_id::text,0));
 if not exists(select 1 from public.shops s
   where s.id=p_shop_id and s.lifecycle_state<>'ARCHIVED') then
   return jsonb_build_object('ok',false,'code','shop_archived_or_missing');
 end if;
 select coalesce(max(s.settings_version),0) into v_current_version
 from public.shop_settings_versions s
 where s.business_id=v_business_id and s.shop_id=p_shop_id;
 if v_current_version<>p_expected_settings_version then
   return jsonb_build_object('ok',false,'code','stale_settings_version',
    'currentVersion',v_current_version);
 end if;
 v_payload:=private.build_effective_shop_settings_payload_v1(
   v_business_id,p_shop_id,p_expected_settings_version+1);
 select s.settings_json->'settings'->'values' into v_prev_values
 from public.shop_settings_versions s
 where s.business_id=v_business_id and s.shop_id=p_shop_id
 order by s.settings_version desc limit 1;
 v_rate_change:=(v_prev_values->'checkout.taxBps') is distinct from
   (v_payload->'settings'->'values'->'checkout.taxBps')
   or (v_prev_values->'checkout.serviceChargeBps') is distinct from
   (v_payload->'settings'->'values'->'checkout.serviceChargeBps');
 return jsonb_build_object('ok',true,'ratesChanged',v_rate_change,
  'payloadFingerprint',md5(v_payload::text));
end;
$rate_preview$;

CREATE OR REPLACE FUNCTION public.publish_shop_settings_v1(p_employee_id uuid, p_shop_id uuid, p_expected_settings_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$ declare v_business_id uuid;v_current_settings_version bigint;v_current_operations_version integer;v_next_settings_version bigint;v_next_operations_version integer;v_payload jsonb;v_base jsonb;v_bundle jsonb;v_now timestamptz:=now();v_prev_values jsonb;v_rate_change boolean; begin if p_expected_settings_version is null or p_expected_settings_version<0 then return jsonb_build_object('ok',false,'code','invalid_expected_version'); end if; v_business_id:=private.assert_admin_settings_permission_v1(p_employee_id,p_shop_id,'settings.manage'); perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_shop_id::text,0)); if not exists(select 1 from public.shops s where s.id=p_shop_id and s.lifecycle_state<>'ARCHIVED') then return jsonb_build_object('ok',false,'code','shop_archived_or_missing'); end if; select coalesce(max(s.settings_version),0) into v_current_settings_version from public.shop_settings_versions s where s.shop_id=p_shop_id; if v_current_settings_version<>p_expected_settings_version then return jsonb_build_object('ok',false,'code','stale_settings_version','currentVersion',v_current_settings_version); end if; select coalesce(max(s.version),0) into v_current_operations_version from public.operations_configuration_snapshots s where s.shop_id=p_shop_id; v_next_settings_version:=v_current_settings_version+1;v_next_operations_version:=v_current_operations_version+1;v_payload:=private.build_effective_shop_settings_payload_v1(v_business_id,p_shop_id,v_next_settings_version);
select x.settings_json->'settings'->'values' into v_prev_values
from public.shop_settings_versions x where x.business_id=v_business_id
and x.shop_id=p_shop_id order by x.settings_version desc limit 1;
v_rate_change:=(v_prev_values->'checkout.taxBps') is distinct from
 (v_payload->'settings'->'values'->'checkout.taxBps')
 or (v_prev_values->'checkout.serviceChargeBps') is distinct from
 (v_payload->'settings'->'values'->'checkout.serviceChargeBps');
if (
 (v_rate_change and exists (
   select 1 from public.admin_approval_rules ar
   where ar.business_id=v_business_id and ar.active
     and ar.action_type='SETTINGS_CHECKOUT_RATE_PUBLISH'
     and (ar.shop_id=p_shop_id or ar.shop_id is null)
 ))
 or exists (
   select 1 from public.admin_approval_requests open_req
   where open_req.business_id=v_business_id and open_req.shop_id=p_shop_id
     and open_req.action_type='SETTINGS_CHECKOUT_RATE_PUBLISH'
     and open_req.status in ('PENDING','APPROVED','EXECUTING')
 )
) and not exists (
 select 1 from public.admin_approval_requests a
 where a.id=nullif(current_setting('tux.approved_checkout_rate_request_id',true),'')::uuid
 and a.business_id=v_business_id and a.shop_id=p_shop_id
 and a.action_type='SETTINGS_CHECKOUT_RATE_PUBLISH'
 and a.requester_employee_id=p_employee_id
 and a.approver_employee_id is not null
 and a.approver_employee_id<>p_employee_id
 and a.status='EXECUTING'
 and a.command_payload=jsonb_build_object(
   'shopId',p_shop_id,
   'expectedSettingsVersion',p_expected_settings_version,
   'payloadFingerprint',md5(v_payload::text)
 )
) then
 return jsonb_build_object('ok',false,'code','checkout_rate_publish_approval_required');
end if;
v_base:=private.build_admin_catalog_core_bundle_v1(p_shop_id,v_next_operations_version,v_now);v_bundle:=private.merge_admin_settings_bundle_v1(v_base,v_payload); insert into public.operations_configuration_snapshots(shop_id,version,bundle_json,published_at,published_by_auth_user_id) values(p_shop_id,v_next_operations_version,v_bundle,v_now,null); insert into public.shop_settings_versions(business_id,shop_id,settings_version,operations_configuration_version,settings_json,bundle_json,published_by_employee_id,published_at) values(v_business_id,p_shop_id,v_next_settings_version,v_next_operations_version,v_payload,v_bundle,p_employee_id,v_now); return jsonb_build_object('ok',true,'settingsVersion',v_next_settings_version,'operationsConfigurationVersion',v_next_operations_version); end; $function$
;

create or replace function public.execute_approved_admin_checkout_rate_publish_v1(
 p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
 p_requester_employee_id uuid,p_approver_employee_id uuid,
 p_expected_settings_version bigint,p_payload_fingerprint text,p_command_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $approved_checkout_publish$
declare
 v_approval public.admin_approval_requests%rowtype;
 v_receipt private.admin_checkout_rate_publish_approval_receipts%rowtype;
 v_expected jsonb;
 v_result jsonb;
 v_requester_business uuid;
 v_approver_business uuid;
begin
 if p_approval_request_id is null or p_business_id is null or p_shop_id is null
   or p_requester_employee_id is null or p_approver_employee_id is null
   or p_expected_settings_version is null or p_expected_settings_version<0
   or p_payload_fingerprint is null
   or p_payload_fingerprint !~ '^[a-f0-9]{32}$'
   or p_command_id is null then
   return jsonb_build_object('ok',false,'code','invalid_approved_checkout_rate_publish');
 end if;
 select * into v_approval from public.admin_approval_requests
 where id=p_approval_request_id and business_id=p_business_id for update;
 if not found then
   return jsonb_build_object('ok',false,'code','approval_request_not_found');
 end if;
 v_expected:=jsonb_build_object(
   'shopId',p_shop_id,'expectedSettingsVersion',p_expected_settings_version,
   'payloadFingerprint',p_payload_fingerprint);
 if v_approval.action_type<>'SETTINGS_CHECKOUT_RATE_PUBLISH'
   or v_approval.shop_id is distinct from p_shop_id
   or v_approval.requester_employee_id<>p_requester_employee_id
   or v_approval.approver_employee_id is distinct from p_approver_employee_id
   or p_requester_employee_id=p_approver_employee_id
   or v_approval.required_approver_permission<>'approvals.review'
   or not v_approval.requires_second_person
   or v_approval.command_id<>p_command_id
   or v_approval.command_payload<>v_expected
   or v_approval.status not in ('EXECUTING','EXECUTED') then
   return jsonb_build_object('ok',false,
     'code','approval_checkout_rate_payload_or_state_mismatch');
 end if;
 v_requester_business:=private.assert_admin_settings_permission_v1(
   p_requester_employee_id,p_shop_id,'settings.manage');
 v_approver_business:=private.assert_admin_settings_permission_v1(
   p_approver_employee_id,p_shop_id,'approvals.review');
 if v_requester_business is distinct from p_business_id
   or v_approver_business is distinct from p_business_id then
   return jsonb_build_object('ok',false,'code','approval_checkout_rate_business_mismatch');
 end if;
 select * into v_receipt from private.admin_checkout_rate_publish_approval_receipts
 where approval_request_id=p_approval_request_id for update;
 if found then
   if v_receipt.business_id<>p_business_id
     or v_receipt.shop_id<>p_shop_id
     or v_receipt.command_id<>p_command_id
     or v_receipt.expected_settings_version<>p_expected_settings_version
     or v_receipt.payload_fingerprint<>p_payload_fingerprint then
     return jsonb_build_object('ok',false,'code','approval_checkout_rate_receipt_conflict');
   end if;
   return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
 end if;
 if v_approval.status<>'EXECUTING' then
   return jsonb_build_object('ok',false,'code','approval_checkout_rate_not_claimed');
 end if;
 perform set_config('tux.approved_checkout_rate_request_id',
   p_approval_request_id::text,true);
 v_result:=public.publish_shop_settings_v1(
   p_requester_employee_id,p_shop_id,p_expected_settings_version);
 perform set_config('tux.approved_checkout_rate_request_id','',true);
 if v_result->>'ok' is distinct from 'true' then return v_result; end if;
 insert into private.admin_checkout_rate_publish_approval_receipts(
   approval_request_id,business_id,shop_id,command_id,expected_settings_version,
   payload_fingerprint,result_json
 ) values (
   p_approval_request_id,p_business_id,p_shop_id,p_command_id,
   p_expected_settings_version,p_payload_fingerprint,v_result
 );
 perform public.append_admin_audit_event_v1(
   p_business_id,p_shop_id,p_approver_employee_id,
   'SETTINGS_CHECKOUT_RATE_APPROVED_PUBLISHED','SETTINGS',p_shop_id::text,
   jsonb_build_object('settingsVersion',p_expected_settings_version),
   jsonb_build_object('settingsVersion',(v_result->>'settingsVersion')::bigint),
   null,p_approval_request_id,null,
   jsonb_build_object('commandId',p_command_id,
     'payloadFingerprint',p_payload_fingerprint)
 );
 return v_result;
end;
$approved_checkout_publish$;

revoke all on function public.preview_admin_checkout_rate_publish_v1(uuid,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.preview_admin_checkout_rate_publish_v1(uuid,uuid,bigint)
 to service_role;
revoke all on function public.publish_shop_settings_v1(uuid,uuid,bigint)
 from public,anon,authenticated;
grant execute on function public.publish_shop_settings_v1(uuid,uuid,bigint)
 to service_role;
revoke all on function public.execute_approved_admin_checkout_rate_publish_v1(
 uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)
 from public,anon,authenticated;
grant execute on function public.execute_approved_admin_checkout_rate_publish_v1(
 uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)
 to service_role;
