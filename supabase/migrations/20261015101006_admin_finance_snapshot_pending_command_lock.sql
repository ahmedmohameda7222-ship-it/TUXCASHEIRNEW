-- PR #119 / Plan 3 & 7: finance command-identity approval lock.
-- A live pending approval binds its original command ID, not merely its
-- exact amount/reason. Prevent altered payload bypass after rule disable.
-- Forward-only replacement of the existing trusted direct snapshot mutator;
-- all auth, snapshot locks, immutable ledger, CAS and audit remain unchanged.
CREATE OR REPLACE FUNCTION public.finance_adjust_snapshot_v1(p_actor_employee_id uuid, p_shop_id uuid, p_snapshot_id uuid, p_amount_minor bigint, p_reason text, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  v_business_id uuid; v_authorized boolean;
  v_existing public.financial_adjustments%rowtype;
  v_id uuid;
  v_policy jsonb;
  v_approval_id uuid;
  v_approved boolean;
  v_open_exact boolean;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.adjust') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_amount_minor is null or p_amount_minor=0
     or nullif(btrim(p_reason),'') is null or length(p_reason)>500
     or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','finance_adjustment_invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text||':finance-adjust:'||p_command_id,0));
  -- Serialize ALL adjustments to the same frozen snapshot across command
  -- IDs so approved expected count cannot race a different direct command.
  perform 1 from public.end_day_financial_snapshots z
    where z.id=p_snapshot_id and z.business_id=v_business_id
      and z.shop_id=p_shop_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','finance_snapshot_not_found');
  end if;
  v_policy:=private.admin_finance_snapshot_approval_policy_v1(
    v_business_id,p_shop_id,p_amount_minor);
  if v_policy->>'policyValid' is distinct from 'true' then
    return jsonb_build_object('ok',false,'code','finance_snapshot_approval_rule_invalid');
  end if;

  -- Pending approval owns its command identity across the business.
  -- A changed amount/reason/snapshot/requester with the SAME command ID
  -- may not silently bypass second-person approval after a rule is disabled.
  -- Other independent commands remain governed by the current policy.
  select exists(
    select 1 from public.admin_approval_requests a
    where a.business_id=v_business_id
      and a.action_type='FINANCE_SNAPSHOT_ADJUST'
      and a.status in ('PENDING','APPROVED','EXECUTING')
      and a.command_payload->>'commandId'=p_command_id
  ) into v_open_exact;
  v_approval_id:=nullif(
    current_setting('tux.approved_finance_snapshot_request_id',true),''
  )::uuid;
  select exists(
    select 1 from public.admin_approval_requests a
    where a.id=v_approval_id and a.business_id=v_business_id
      and a.shop_id=p_shop_id and a.action_type='FINANCE_SNAPSHOT_ADJUST'
      and a.requester_employee_id=p_actor_employee_id
      and a.approver_employee_id is not null
      and a.approver_employee_id<>p_actor_employee_id
      and a.status='EXECUTING'
      and a.command_payload->>'snapshotId'=p_snapshot_id::text
      and a.command_payload->>'amountMinor'=p_amount_minor::text
      and a.command_payload->>'reason'=btrim(p_reason)
      and a.command_payload->>'commandId'=p_command_id
  ) into v_approved;
  if ((v_policy->>'approvalRequired')::boolean or v_open_exact)
      and not v_approved then
    return jsonb_build_object('ok',false,'code','finance_snapshot_approval_required');
  end if;

  select * into v_existing from public.financial_adjustments
    where business_id=v_business_id and command_id=p_command_id;
  if found then
    if v_existing.snapshot_id=p_snapshot_id and v_existing.amount_minor=p_amount_minor
       and v_existing.reason=btrim(p_reason) and
       v_existing.created_by_employee_id=p_actor_employee_id then
      return jsonb_build_object('ok',true,'replayed',true,'adjustmentId',v_existing.id);
    end if;
    return jsonb_build_object('ok',false,'code','finance_command_conflict');
  end if;
  insert into public.financial_adjustments(
    business_id,shop_id,snapshot_id,amount_minor,reason,command_id,created_by_employee_id)
  values(v_business_id,p_shop_id,p_snapshot_id,p_amount_minor,
    btrim(p_reason),p_command_id,p_actor_employee_id) returning id into v_id;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_SNAPSHOT_ADJUSTED','FINANCIAL_SNAPSHOT',p_snapshot_id::text,
    null,jsonb_build_object('adjustmentId',v_id,'amountMinor',p_amount_minor),
    p_reason,null,null,'{}'::jsonb);
  return jsonb_build_object('ok',true,'replayed',false,'adjustmentId',v_id);
end;
$function$;

revoke all on function public.finance_adjust_snapshot_v1(uuid,uuid,uuid,bigint,text,text)
 from public,anon,authenticated;
grant execute on function public.finance_adjust_snapshot_v1(uuid,uuid,uuid,bigint,text,text)
 to service_role;
