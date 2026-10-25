-- Off-shift Inventory ledger replay fence: counted ledger entries, not timestamps.
-- All writes remain in Inventory's isolated branch. Do not apply until serialized
-- Catalog / Orders / Inventory approval and complete database migration tests.
--
-- Why: offline replay can have an event created_at OLDER than stocktake.started_at.
-- The old date-only drift check incorrectly allowed that transaction to post.
-- Capture the exact number of recorded movements when each physical line starts.
-- Any later ledger insertion, including a backdated one or net-zero compensation,
-- makes the snapshot stale. Existing pre-migration DRAFT lines remain NULL and
-- deliberately fail closed; operator must reconcile and create a new count.

alter table public.stocktake_lines
  add column if not exists snapshot_movement_count bigint;

create or replace function private.stocktake_capture_ledger_count_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_shop_id uuid;
begin
  select s.shop_id into v_shop_id
  from public.stocktakes s where s.id = new.stocktake_id;
  if v_shop_id is null then
    raise exception 'stocktake_not_found' using errcode = '23503';
  end if;

  select count(*) into new.snapshot_movement_count
  from public.inventory_movements m
  where m.shop_id = v_shop_id
    and m.inventory_item_id = new.inventory_item_id;
  return new;
end;
$function$;

revoke all on function private.stocktake_capture_ledger_count_v1()
  from public, anon, authenticated;

drop trigger if exists tux_stocktake_capture_movement_count on public.stocktake_lines;
create trigger tux_stocktake_capture_movement_count
  before insert on public.stocktake_lines
  for each row execute function private.stocktake_capture_ledger_count_v1();

create or replace function private.inventory_stocktake_ledger_drift_v1(
  p_stocktake_id uuid,
  p_shop_id uuid,
  p_post_command_id text
) returns boolean
language sql stable
set search_path = pg_catalog, public, private
as $function$
  select exists (
    select 1
    from public.stocktake_lines l
    where l.stocktake_id = p_stocktake_id
      and (
        l.snapshot_movement_count is null
        or l.snapshot_movement_count <> (
          select count(*)
          from public.inventory_movements m
          where m.shop_id = p_shop_id
            and m.inventory_item_id = l.inventory_item_id
            and not (
              p_post_command_id is not null
              and m.movement_type = 'STOCKTAKE_ADJUSTMENT'
              and m.command_id = p_post_command_id
            )
        )
        or l.snapshot_reserved_micros is distinct from (
          select b.reserved_micros
          from private.inventory_balance_v1(p_shop_id, l.inventory_item_id) b
        )
      )
  );
$function$;

revoke all on function private.inventory_stocktake_ledger_drift_v1(uuid,uuid,text)
  from public, anon, authenticated;

create or replace function private.enforce_stocktake_ledger_fence_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if new.status = 'POSTED' and old.status <> 'POSTED'
     and private.inventory_stocktake_ledger_drift_v1(
       old.id, old.shop_id, new.post_command_id
     ) then
    raise exception using errcode = 'P0001',
      message = 'stocktake_snapshot_stale',
      detail = 'A ledger movement was added after the count, even if it carries an older event timestamp.';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_stocktake_ledger_fence_v1()
  from public, anon, authenticated;

drop trigger if exists tux_inventory_stocktake_ledger_fence on public.stocktakes;
create trigger tux_inventory_stocktake_ledger_fence
  before update of status on public.stocktakes
  for each row execute function private.enforce_stocktake_ledger_fence_v1();

-- The approved read and draft save functions are replaced with the original
-- checked-in definitions, altering ONLY the stale predicate to use the
-- shared recorded-ledger/count fence, not client-controlled event timestamps.

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
      'stale', s.status = 'DRAFT' and private.inventory_stocktake_ledger_drift_v1(s.id, s.shop_id, null),
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
  if private.inventory_stocktake_ledger_drift_v1(p_stocktake_id, p_shop_id, null) then
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
    if not exists (
      select 1 from public.stocktake_lines
      where stocktake_id = p_stocktake_id and inventory_item_id = v_item_id
    ) then
      return jsonb_build_object('ok',false,'code','stocktake_line_set_mismatch');
    end if;
  end loop;

  -- Do not mutate a single line until ALL submitted lines have been checked.
  -- A rejected multi-line payload must never leave a partially saved draft.
  for v_line in select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    update public.stocktake_lines
    set actual_count_micros = (v_line ->> 'actualCountMicros')::bigint
    where stocktake_id = p_stocktake_id
      and inventory_item_id = (v_line ->> 'inventoryItemId')::uuid;
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

revoke all on function public.read_admin_stocktake_sessions_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_stocktake_sessions_v1(uuid,uuid)
  to service_role;
revoke all on function public.save_admin_stocktake_draft_v1(uuid,uuid,uuid,bigint,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.save_admin_stocktake_draft_v1(uuid,uuid,uuid,bigint,jsonb,text)
  to service_role;
