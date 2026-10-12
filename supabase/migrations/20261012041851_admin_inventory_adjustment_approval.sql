-- Plan 3 / Plan 4 correction D: trusted, fail-closed inventory adjustment approval.
-- Expand only; old clients without active rules retain original direct behavior.
-- An active shop-local rule overrides a business-wide rule even below threshold.
-- Emergency negative override remains OWNER-only and requires its original permission.
-- Only the trusted execution RPC can install a validated approval context.
create or replace function public.post_inventory_adjustment_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_id uuid,
  p_quantity_delta_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_role text;
  v_reason_key text;
  v_reason_label text;
  v_reason_family text;
  v_reason_version bigint;
  v_on_hand bigint;
  v_reserved bigint;
  v_available bigint;
  v_new_available bigint;
  v_override_authorized boolean;
  v_movement_id uuid;
  v_approval_rule public.admin_approval_rules%rowtype;
  v_approval_needed boolean := false;
  v_threshold_value numeric;
  v_approval_request_id text;
  v_approval public.admin_approval_requests%rowtype;
begin
  if p_employee_id is null or p_shop_id is null or p_inventory_item_id is null
     or p_quantity_delta_micros is null or p_quantity_delta_micros = 0
     or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_adjustment_command');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-adjustment-command:' || p_shop_id::text || ':' || p_command_id,
      0
    )
  );

  if exists (
    select 1 from public.inventory_movements m
    where m.shop_id = p_shop_id
      and m.source_kind = 'ADMIN'
      and m.command_id = p_command_id
      and m.movement_type = 'ADMIN_ADJUSTMENT'
  ) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  select a.business_id, a.employee_role
    into v_business_id, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.adjust'
  ) a;

  perform private.assert_inventory_item_shop_v1(p_shop_id, p_inventory_item_id);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || p_shop_id::text || ':' || p_inventory_item_id::text,
      0
    )
  );

  select r.reason_code_key, r.reason_label, r.reason_family, r.reason_version
    into v_reason_key, v_reason_label, v_reason_family, v_reason_version
  from private.inventory_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'STOCK_ADJUSTMENT'
  ) r;

  select b.on_hand_micros, b.reserved_micros, b.available_micros
    into v_on_hand, v_reserved, v_available
  from private.inventory_balance_v1(p_shop_id, p_inventory_item_id) b;

  v_new_available := v_on_hand + p_quantity_delta_micros - v_reserved;
  if v_new_available < 0 then
    if not coalesce(p_emergency_negative_override, false) then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'availableMicros', v_available
      );
    end if;

    if v_role <> 'OWNER' or p_note is null or btrim(p_note) = '' then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;

    select a.authorized into v_override_authorized
    from public.resolve_admin_authorization_v1(
      p_employee_id, p_shop_id, 'inventory.override_negative'
    ) a
    limit 1;
    if not coalesce(v_override_authorized, false) then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;
  end if;

  -- Shop-local rule always governs over the business-wide fallback.
  -- This guard runs in the trusted posting RPC, not merely in an Admin browser.
  select * into v_approval_rule
  from public.admin_approval_rules r
  where r.business_id = v_business_id
    and r.action_type = 'INVENTORY_ADJUST'
    and r.active
    and (r.shop_id is null or r.shop_id = p_shop_id)
  order by (r.shop_id = p_shop_id) desc nulls last, r.id
  limit 1;
  if found then
    if jsonb_typeof(v_approval_rule.threshold_context) <> 'object'
       or exists (
          select 1 from jsonb_object_keys(v_approval_rule.threshold_context) k
          where k <> 'minimumQuantityImpact'
       ) then
      return jsonb_build_object('ok',false,'code','approval_threshold_context_invalid');
    end if;
    if v_approval_rule.threshold_context ? 'minimumQuantityImpact' then
      if jsonb_typeof(v_approval_rule.threshold_context->'minimumQuantityImpact') <> 'number' then
        return jsonb_build_object('ok',false,'code','approval_threshold_context_invalid');
      end if;
      begin
        v_threshold_value := (v_approval_rule.threshold_context->>'minimumQuantityImpact')::numeric;
      exception when others then
        return jsonb_build_object('ok',false,'code','approval_threshold_context_invalid');
      end;
      if v_threshold_value <= 0 or v_threshold_value <> trunc(v_threshold_value) then
        return jsonb_build_object('ok',false,'code','approval_threshold_context_invalid');
      end if;
      v_approval_needed := abs(p_quantity_delta_micros::numeric) >= v_threshold_value * 1000000;
    else
      v_approval_needed := true;
    end if;
  end if;
  if v_approval_needed then
    v_approval_request_id := nullif(current_setting('tux.inventory_approval_request_id',true),'');
    if v_approval_request_id is null then
      return jsonb_build_object('ok',false,'code','inventory_approval_required');
    end if;
    select * into v_approval
    from public.admin_approval_requests a
    where a.id = v_approval_request_id::uuid
      and a.business_id = v_business_id
      and a.shop_id = p_shop_id
      and a.action_type = 'INVENTORY_ADJUST'
      and a.status = 'EXECUTING'
      and a.requester_employee_id = p_employee_id
      and a.command_payload->>'originalCommandId' = p_command_id
      and (a.command_payload->>'inventoryItemId')::uuid = p_inventory_item_id
      and (a.command_payload->>'quantityDeltaMicros')::bigint = p_quantity_delta_micros
      and (a.command_payload->>'reasonCodeId')::uuid = p_reason_code_id
      and (a.command_payload->>'emergencyNegativeOverride')::boolean =
        coalesce(p_emergency_negative_override,false)
    for share;
    if not found or
       v_approval.requires_second_person and
       v_approval.approver_employee_id = p_employee_id then
      return jsonb_build_object('ok',false,'code','inventory_approval_execution_forbidden');
    end if;
  end if;

  -- A pending/decided adjustment cannot be posted directly by replaying
  -- its original command after an administrator changes the approval rule.
  -- This also prevents an alternate requester from taking the command ID.
  if nullif(current_setting('tux.inventory_approval_request_id',true),'') is null
     and exists (
       select 1 from public.admin_approval_requests a
       where a.business_id=v_business_id and a.shop_id=p_shop_id
         and a.action_type='INVENTORY_ADJUST'
         and a.command_payload->>'originalCommandId'=p_command_id
     ) then
    return jsonb_build_object('ok',false,'code','inventory_approval_command_locked');
  end if;

  v_movement_id := gen_random_uuid();
  insert into public.inventory_movements(
    id,
    shop_id,
    business_day_id,
    inventory_item_id,
    movement_type,
    quantity_delta_micros,
    reserved_delta_micros,
    worker_id,
    order_id,
    compensates_movement_id,
    idempotency_key,
    admin_employee_id,
    source_kind,
    command_id,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    emergency_negative_override,
    created_at
  ) values (
    v_movement_id,
    p_shop_id,
    null,
    p_inventory_item_id,
    'ADMIN_ADJUSTMENT',
    p_quantity_delta_micros,
    0,
    null,
    null,
    null,
    'admin-adjustment:' || p_command_id,
    p_employee_id,
    'ADMIN',
    p_command_id,
    p_reason_code_id,
    v_reason_key,
    v_reason_label,
    v_reason_family,
    v_reason_version,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_emergency_negative_override, false),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'movementId', v_movement_id,
    'onHandMicros', v_on_hand + p_quantity_delta_micros,
    'reservedMicros', v_reserved,
    'availableMicros', v_new_available
  );
end;
$$;

revoke all on function public.post_inventory_adjustment_v1(
  uuid,uuid,uuid,bigint,uuid,text,text,boolean
) from public,anon,authenticated;
grant execute on function public.post_inventory_adjustment_v1(
  uuid,uuid,uuid,bigint,uuid,text,text,boolean
) to service_role;

create or replace function public.read_admin_inventory_adjustment_fence_v1(
  p_employee_id uuid, p_shop_id uuid, p_inventory_item_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog,public,private
as $fence$
declare
  v_business_id uuid;
  v_version bigint;
  v_count bigint;
begin
  select business_id into v_business_id
  from private.admin_inventory_authority_v1(
    p_employee_id,p_shop_id,'inventory.adjust'
  );
  if v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  select definition_version into v_version
  from public.inventory_items
  where id=p_inventory_item_id and shop_id=p_shop_id and active;
  if not found then
    return jsonb_build_object('ok',false,'code','inventory_item_not_found');
  end if;
  select count(*) into v_count
  from public.inventory_movements
  where shop_id=p_shop_id and inventory_item_id=p_inventory_item_id;
  return jsonb_build_object(
    'ok',true,'expectedDefinitionVersion',v_version,
    'expectedMovementCount',v_count
  );
end;
$fence$;
revoke all on function public.read_admin_inventory_adjustment_fence_v1(
  uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function public.read_admin_inventory_adjustment_fence_v1(
  uuid,uuid,uuid
) to service_role;

create or replace function public.execute_approved_admin_inventory_adjustment_v1(
  p_approval_request_id uuid,
  p_business_id uuid,
  p_shop_id uuid,
  p_requester_employee_id uuid,
  p_approver_employee_id uuid,
  p_inventory_item_id uuid,
  p_quantity_delta_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean,
  p_expected_definition_version bigint,
  p_expected_movement_count bigint
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog,public,private
as $approved$
declare
  v_approval public.admin_approval_requests%rowtype;
  v_item_version bigint;
  v_movement_count bigint;
  v_existing public.inventory_movements%rowtype;
  v_expected jsonb;
  v_result jsonb;
begin
  if p_approval_request_id is null or p_business_id is null
     or p_shop_id is null or p_requester_employee_id is null
     or p_approver_employee_id is null or p_inventory_item_id is null
     or p_quantity_delta_micros is null or p_quantity_delta_micros=0
     or p_reason_code_id is null or nullif(btrim(p_command_id),'') is null
     or p_expected_definition_version is null or p_expected_definition_version<=0
     or p_expected_movement_count is null or p_expected_movement_count<0 then
    return jsonb_build_object('ok',false,'code','invalid_approved_inventory_adjustment');
  end if;
  select * into v_approval
  from public.admin_approval_requests
  where id=p_approval_request_id and business_id=p_business_id
  for update;
  if not found then return jsonb_build_object('ok',false,'code','approval_request_not_found'); end if;

  v_expected := jsonb_build_object(
    'shopId',p_shop_id,
    'inventoryItemId',p_inventory_item_id,
    'quantityDeltaMicros',p_quantity_delta_micros,
    'reasonCodeId',p_reason_code_id,
    'note',p_note,
    'originalCommandId',p_command_id,
    'emergencyNegativeOverride',p_emergency_negative_override,
    'expectedDefinitionVersion',p_expected_definition_version,
    'expectedMovementCount',p_expected_movement_count
  );
  if v_approval.action_type <> 'INVENTORY_ADJUST'
     or v_approval.shop_id is distinct from p_shop_id
     or v_approval.requester_employee_id <> p_requester_employee_id
     or v_approval.approver_employee_id is distinct from p_approver_employee_id
     or v_approval.command_payload <> v_expected
     or v_approval.status <> 'EXECUTING' then
    return jsonb_build_object('ok',false,'code','approval_inventory_payload_or_state_mismatch');
  end if;
  if v_approval.requires_second_person
     and p_requester_employee_id=p_approver_employee_id then
    return jsonb_build_object('ok',false,'code','self_approval_forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'tux-admin-adjustment-command:'||p_shop_id::text||':'||p_command_id,0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'tux-inventory:'||p_shop_id::text||':'||p_inventory_item_id::text,0
  ));
  select * into v_existing from public.inventory_movements
  where shop_id=p_shop_id and source_kind='ADMIN'
    and command_id=p_command_id and movement_type='ADMIN_ADJUSTMENT'
  for share;
  if found then
    if v_existing.inventory_item_id<>p_inventory_item_id
       or v_existing.quantity_delta_micros<>p_quantity_delta_micros
       or v_existing.reason_code_id is distinct from p_reason_code_id
       or v_existing.admin_employee_id is distinct from p_requester_employee_id then
      return jsonb_build_object('ok',false,'code','inventory_adjustment_command_conflict');
    end if;
    return jsonb_build_object('ok',true,'idempotentReplay',true,'movementId',v_existing.id);
  end if;

  select definition_version into v_item_version
  from public.inventory_items
  where id=p_inventory_item_id and shop_id=p_shop_id and active
  for update;
  if not found then return jsonb_build_object('ok',false,'code','inventory_item_not_found'); end if;
  select count(*) into v_movement_count
  from public.inventory_movements
  where shop_id=p_shop_id and inventory_item_id=p_inventory_item_id;
  if v_item_version<>p_expected_definition_version
     or v_movement_count<>p_expected_movement_count then
    return jsonb_build_object('ok',false,'code','stale_inventory_version');
  end if;
  perform set_config('tux.inventory_approval_request_id',p_approval_request_id::text,true);
  v_result:=public.post_inventory_adjustment_v1(
    p_requester_employee_id,p_shop_id,p_inventory_item_id,p_quantity_delta_micros,
    p_reason_code_id,p_note,p_command_id,p_emergency_negative_override
  );
  perform set_config('tux.inventory_approval_request_id','',true);
  if coalesce((v_result->>'ok')::boolean,false)=false then
    return v_result;
  end if;
  perform public.append_admin_audit_event_v1(
    p_business_id,p_shop_id,p_approver_employee_id,
    'INVENTORY_ADJUSTMENT_APPROVED_POSTED','INVENTORY_ITEM',
    p_inventory_item_id::text,null,
    jsonb_build_object('approvalRequestId',p_approval_request_id,
      'movementId',v_result->>'movementId',
      'quantityDeltaMicros',p_quantity_delta_micros),
    p_note,p_approval_request_id,null,
    jsonb_build_object('commandId',p_command_id)
  );
  return v_result;
end;
$approved$;
revoke all on function public.execute_approved_admin_inventory_adjustment_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,boolean,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.execute_approved_admin_inventory_adjustment_v1(
  uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,boolean,bigint,bigint
) to service_role;
