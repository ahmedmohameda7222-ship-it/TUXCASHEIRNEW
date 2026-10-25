-- TUX Inventory stream: persisted physical count recovery and stale fencing.
-- Apply after the earlier three Inventory migrations, serially with Catalog and Orders.
-- Retains the existing server-authorized physical count and append-only ledger.
alter table public.stocktakes
  add column if not exists draft_revision bigint not null default 0;
alter table public.stocktakes
  add column if not exists draft_save_command_id text;
alter table public.stocktakes
  add column if not exists draft_save_payload_md5 text;
alter table public.stocktakes
  add column if not exists cancel_command_id text;
alter table public.stocktakes
  add column if not exists cancelled_at timestamptz;
alter table public.stocktakes
  add column if not exists cancelled_by_employee_id uuid
    references public.business_employees(id);
alter table public.stocktakes
  add constraint stocktakes_draft_revision_nonnegative
  check (draft_revision >= 0);
create unique index if not exists stocktakes_shop_cancel_command_unique
  on public.stocktakes(shop_id,cancel_command_id)
  where cancel_command_id is not null;

create or replace function public.read_admin_stocktake_sessions_v1(
  p_employee_id uuid, p_shop_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_sessions jsonb;
begin
  perform 1 from private.admin_inventory_authority_v1(
    p_employee_id,p_shop_id,'inventory.stocktake'
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'stocktakeId', s.id,
      'shopId', s.shop_id,
      'status', s.status,
      'startedAt', s.started_at,
      'postedAt', s.posted_at,
      'cancelledAt', s.cancelled_at,
      'draftRevision', s.draft_revision,
      'stale', s.status = 'DRAFT' and exists (
        select 1 from public.stocktake_lines l
        join public.inventory_movements m
          on m.shop_id = s.shop_id and m.inventory_item_id = l.inventory_item_id
        where l.stocktake_id = s.id and m.created_at > s.started_at
      ),
      'lines', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'inventoryItemId', l.inventory_item_id,
            'snapshotOnHandMicros', l.snapshot_on_hand_micros,
            'snapshotReservedMicros', l.snapshot_reserved_micros,
            'unitCostMinor', l.unit_cost_minor,
            'actualCountMicros', l.actual_count_micros
          ) order by l.inventory_item_id
        ),'[]'::jsonb) from public.stocktake_lines l where l.stocktake_id = s.id
      )
    ) order by s.started_at desc,s.id desc),'[]'::jsonb)
  into v_sessions
  from (
    select st.* from public.stocktakes st
    where st.shop_id = p_shop_id
    order by st.started_at desc,st.id desc limit 50
  ) s;

  return jsonb_build_object('ok',true,'sessions',v_sessions);
end;
$function$;

create or replace function public.save_admin_stocktake_draft_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_stocktake_id uuid,
  p_expected_revision bigint,
  p_lines jsonb,
  p_command_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_stocktake public.stocktakes%rowtype;
  v_fingerprint text;
  v_line jsonb;
  v_item_id uuid;
  v_actual bigint;
  v_blocker text;
begin
  if p_employee_id is null or p_shop_id is null or p_stocktake_id is null
     or p_expected_revision is null or p_expected_revision < 0
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok',false,'code','invalid_stocktake_draft_command');
  end if;

  perform 1 from private.admin_inventory_authority_v1(
    p_employee_id,p_shop_id,'inventory.stocktake'
  );

  select * into v_stocktake from public.stocktakes
  where id = p_stocktake_id and shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok',false,'code','stocktake_not_found');
  end if;

  v_fingerprint := md5(p_lines::text);
  if v_stocktake.draft_save_command_id = p_command_id then
    if v_stocktake.draft_save_payload_md5 = v_fingerprint then
      return jsonb_build_object('ok',true,'idempotentReplay',true,
        'draftRevision',v_stocktake.draft_revision);
    end if;
    return jsonb_build_object('ok',false,'code','idempotency_conflict');
  end if;

  if v_stocktake.status <> 'DRAFT' then
    return jsonb_build_object('ok',false,'code','stocktake_not_editable');
  end if;
  if v_stocktake.draft_revision <> p_expected_revision then
    return jsonb_build_object('ok',false,'code','stale_version',
      'currentVersion',v_stocktake.draft_revision);
  end if;

  v_blocker := private.inventory_stocktake_blocker_v1(p_shop_id);
  if v_blocker is not null then
    return jsonb_build_object('ok',false,'code','stocktake_requires_off_shift');
  end if;
  if exists (
    select 1 from public.stocktake_lines l
    join public.inventory_movements m
      on m.shop_id = p_shop_id and m.inventory_item_id = l.inventory_item_id
    where l.stocktake_id = p_stocktake_id and m.created_at > v_stocktake.started_at
  ) then
    return jsonb_build_object('ok',false,'code','stocktake_snapshot_stale');
  end if;

  if jsonb_array_length(p_lines) <> (
    select count(*) from public.stocktake_lines where stocktake_id = p_stocktake_id
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) x
    group by x.value ->> 'inventoryItemId' having count(*) > 1
  ) then
    return jsonb_build_object('ok',false,'code','stocktake_line_set_mismatch');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_actual := null;
      if jsonb_typeof(v_line -> 'actualCountMicros') not in ('number','null')
         or v_line -> 'actualCountMicros' is null then
        return jsonb_build_object('ok',false,'code','invalid_stocktake_line');
      end if;
      if (v_line ->> 'actualCountMicros') is not null then
        v_actual := (v_line ->> 'actualCountMicros')::bigint;
        if v_actual < 0 then
          return jsonb_build_object('ok',false,'code','invalid_stocktake_line');
        end if;
      end if;
    exception when others then
      return jsonb_build_object('ok',false,'code','invalid_stocktake_line');
    end;
    update public.stocktake_lines set actual_count_micros = v_actual
    where stocktake_id = p_stocktake_id and inventory_item_id = v_item_id;
    if not found then
      return jsonb_build_object('ok',false,'code','stocktake_line_set_mismatch');
    end if;
  end loop;

  update public.stocktakes
  set draft_revision = draft_revision + 1,
      draft_save_command_id = p_command_id,
      draft_save_payload_md5 = v_fingerprint
  where id = p_stocktake_id;
  return jsonb_build_object('ok',true,'idempotentReplay',false,
    'draftRevision',v_stocktake.draft_revision + 1);
end;
$function$;

create or replace function public.cancel_admin_stocktake_draft_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_stocktake_id uuid,
  p_command_id text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_stocktake public.stocktakes%rowtype;
begin
  if p_employee_id is null or p_shop_id is null or p_stocktake_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok',false,'code','invalid_stocktake_cancel_command');
  end if;
  perform 1 from private.admin_inventory_authority_v1(
    p_employee_id,p_shop_id,'inventory.stocktake'
  );
  select * into v_stocktake from public.stocktakes
  where id = p_stocktake_id and shop_id = p_shop_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','stocktake_not_found');
  end if;
  if v_stocktake.status = 'CANCELLED' then
    if v_stocktake.cancel_command_id = p_command_id then
      return jsonb_build_object('ok',true,'idempotentReplay',true,
        'stocktakeId',v_stocktake.id);
    end if;
    return jsonb_build_object('ok',false,'code','idempotency_conflict');
  end if;
  if v_stocktake.status <> 'DRAFT' then
    return jsonb_build_object('ok',false,'code','stocktake_not_cancellable');
  end if;

  update public.stocktakes
  set status = 'CANCELLED',
      cancel_command_id = p_command_id,
      cancelled_at = now(),
      cancelled_by_employee_id = p_employee_id
  where id = v_stocktake.id;
  return jsonb_build_object('ok',true,'idempotentReplay',false,
    'stocktakeId',v_stocktake.id);
end;
$function$;

revoke all on function public.read_admin_stocktake_sessions_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_stocktake_sessions_v1(uuid,uuid)
  to service_role;
revoke all on function public.save_admin_stocktake_draft_v1(uuid,uuid,uuid,bigint,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.save_admin_stocktake_draft_v1(uuid,uuid,uuid,bigint,jsonb,text)
  to service_role;
revoke all on function public.cancel_admin_stocktake_draft_v1(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.cancel_admin_stocktake_draft_v1(uuid,uuid,uuid,text)
  to service_role;
