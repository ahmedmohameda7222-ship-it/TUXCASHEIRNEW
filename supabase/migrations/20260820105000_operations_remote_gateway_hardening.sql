-- Hardening for the authenticated Operations remote gateway before first live use.
-- This migration keeps enrollment retry-safe and serializes remote row guards by
-- logical conflict identity instead of by the mutable row payload.

create or replace function public.release_tux_device_enrollment(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.device_enrollment_codes enrollment
     set claimed_at = null
   where enrollment.id = p_enrollment_id
     and enrollment.claimed_at is not null
     and enrollment.completed_at is null
     and enrollment.expires_at > now();
  return found;
end;
$$;

revoke all on function public.release_tux_device_enrollment(uuid)
  from public, anon, authenticated;
grant execute on function public.release_tux_device_enrollment(uuid)
  to service_role;

create or replace function private.apply_tux_remote_mutation_serialized(p_mutation jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_table text := p_mutation ->> 'table';
  v_row jsonb := p_mutation -> 'row';
  v_conflicts text[];
  v_column text;
  v_lock_identity text;
begin
  if jsonb_typeof(v_row) <> 'object' then
    raise exception 'TUX_SYNC_ROW_INVALID';
  end if;
  if jsonb_typeof(p_mutation -> 'conflictColumns') <> 'array' then
    raise exception 'TUX_SYNC_CONFLICT_COLUMNS_REQUIRED';
  end if;

  select array_agg(value order by ordinality)
    into v_conflicts
  from jsonb_array_elements_text(p_mutation -> 'conflictColumns') with ordinality;
  if coalesce(array_length(v_conflicts, 1), 0) = 0 then
    raise exception 'TUX_SYNC_CONFLICT_COLUMNS_REQUIRED';
  end if;

  v_lock_identity := coalesce(v_table, '<null>');
  foreach v_column in array v_conflicts loop
    if not (v_row ? v_column) then
      raise exception 'TUX_SYNC_CONFLICT_VALUE_MISSING:%', v_column;
    end if;
    v_lock_identity := v_lock_identity || '|' || v_column || '=' || (v_row -> v_column)::text;
  end loop;

  -- Different revisions or timestamps for the same logical row must acquire the same
  -- lock before the existing-row read and monotonic guard inside apply_tux_remote_mutation.
  perform pg_advisory_xact_lock(hashtextextended('remote-row:' || v_lock_identity, 0));
  perform private.apply_tux_remote_mutation(p_mutation);
end;
$$;

revoke all on function private.apply_tux_remote_mutation_serialized(jsonb)
  from public, anon, authenticated;

create or replace function public.ingest_tux_operations_materialization_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_envelope jsonb,
  p_payload_sha256 text,
  p_plan jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_event_id uuid;
  v_shop_id uuid;
  v_idempotency_key text;
  v_event_type text;
  v_payload_version integer;
  v_existing public.operations_sync_event_receipts%rowtype;
  v_mutation jsonb;
begin
  if jsonb_typeof(p_envelope) <> 'object' or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'TUX_SYNC_PROTOCOL_INVALID';
  end if;

  v_event_id := (p_envelope ->> 'eventId')::uuid;
  v_shop_id := (p_envelope ->> 'shopId')::uuid;
  v_idempotency_key := p_envelope ->> 'idempotencyKey';
  v_event_type := p_envelope ->> 'eventType';
  v_payload_version := (p_envelope ->> 'payloadVersion')::integer;

  if v_payload_version <> 1
     or v_idempotency_key is null
     or btrim(v_idempotency_key) = ''
     or length(coalesce(p_payload_sha256, '')) <> 64 then
    raise exception 'TUX_SYNC_PROTOCOL_INVALID';
  end if;

  if p_plan ->> 'eventId' <> v_event_id::text
     or p_plan ->> 'shopId' <> v_shop_id::text
     or p_plan ->> 'idempotencyKey' <> v_idempotency_key
     or p_plan ->> 'eventType' <> v_event_type then
    raise exception 'TUX_SYNC_PLAN_IDENTITY_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.shop_memberships membership
    join public.devices device
      on device.shop_id = membership.shop_id
     and device.auth_user_id = membership.auth_user_id
    where membership.shop_id = v_shop_id
      and membership.auth_user_id = p_auth_user_id
      and membership.role = 'OPERATIONS_DEVICE'
      and membership.active
      and device.id = p_device_id
      and device.auth_user_id = p_auth_user_id
      and device.active
  ) then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('receipt:' || v_shop_id::text || ':' || v_event_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'aggregate:' || v_shop_id::text || ':' || coalesce(p_envelope ->> 'aggregateType', '') || ':' ||
      coalesce(p_envelope ->> 'aggregateId', ''),
      0
    )
  );

  select * into v_existing
  from public.operations_sync_event_receipts
  where event_id = v_event_id
     or (shop_id = v_shop_id and idempotency_key = v_idempotency_key)
  order by case when event_id = v_event_id then 0 else 1 end
  limit 1;

  if found then
    if v_existing.event_id = v_event_id
       and v_existing.shop_id = v_shop_id
       and v_existing.idempotency_key = v_idempotency_key
       and v_existing.event_type = v_event_type
       and v_existing.payload_version = v_payload_version
       and v_existing.payload_sha256 = p_payload_sha256 then
      return 'REPLAY';
    end if;
    raise exception 'TUX_PROTOCOL_CONFLICT';
  end if;

  if jsonb_typeof(p_plan -> 'mutations') <> 'array' then
    raise exception 'TUX_SYNC_PLAN_INVALID';
  end if;

  for v_mutation in select value from jsonb_array_elements(p_plan -> 'mutations') loop
    if v_mutation -> 'row' ? 'shop_id'
       and v_mutation #>> '{row,shop_id}' <> v_shop_id::text then
      raise exception 'TUX_SYNC_MUTATION_SHOP_MISMATCH';
    end if;
    perform private.apply_tux_remote_mutation_serialized(v_mutation);
  end loop;

  insert into public.operations_sync_event_receipts(
    event_id,
    shop_id,
    idempotency_key,
    event_type,
    payload_version,
    payload_sha256,
    envelope_json
  ) values (
    v_event_id,
    v_shop_id,
    v_idempotency_key,
    v_event_type,
    v_payload_version,
    p_payload_sha256,
    p_envelope
  );

  update public.devices
     set last_seen_at = now()
   where id = p_device_id and shop_id = v_shop_id and auth_user_id = p_auth_user_id;

  return 'APPLIED';
end;
$$;

revoke all on function public.ingest_tux_operations_materialization_v1(uuid, uuid, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_tux_operations_materialization_v1(uuid, uuid, jsonb, text, jsonb)
  to service_role;
