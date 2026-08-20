-- TUX Operations V2 authenticated device enrollment, configuration delivery, and
-- exactly-once remote materialization gateway.
--
-- Operations clients never receive service_role credentials and never write the
-- operational tables directly. A short-lived Supabase Auth access token identifies
-- the enrolled device; trusted Edge Functions call the service-role-only RPCs below.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

alter table public.devices
  add column auth_user_id uuid references auth.users(id) on delete restrict;

create unique index devices_auth_user_id_unique_idx
  on public.devices(auth_user_id)
  where auth_user_id is not null;
create index devices_shop_auth_active_idx
  on public.devices(shop_id, auth_user_id, active);

-- Every remotely enrolled device is represented by exactly one active Auth user and
-- a matching OPERATIONS_DEVICE shop membership.
alter table public.devices
  add constraint devices_shop_auth_membership_fk
    foreign key (shop_id, auth_user_id)
      references public.shop_memberships(shop_id, auth_user_id);

create table private.device_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  device_label text not null check (btrim(device_label) <> ''),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  completed_auth_user_id uuid references auth.users(id) on delete restrict,
  completed_device_id uuid references public.devices(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (completed_at is null or claimed_at is not null),
  check (
    (completed_at is null and completed_auth_user_id is null and completed_device_id is null) or
    (completed_at is not null and completed_auth_user_id is not null and completed_device_id is not null)
  )
);
create index device_enrollment_codes_shop_expiry_idx
  on private.device_enrollment_codes(shop_id, expires_at desc);

create table public.operations_configuration_snapshots (
  shop_id uuid not null references public.shops(id) on delete cascade,
  version integer not null check (version > 0),
  bundle_json jsonb not null check (jsonb_typeof(bundle_json) = 'object'),
  published_at timestamptz not null default now(),
  published_by_auth_user_id uuid references auth.users(id) on delete restrict,
  primary key (shop_id, version)
);
create index operations_configuration_snapshots_latest_idx
  on public.operations_configuration_snapshots(shop_id, version desc);
alter table public.operations_configuration_snapshots enable row level security;

create or replace function private.has_active_shop_membership(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.shop_memberships membership
    where membership.shop_id = p_shop_id
      and membership.auth_user_id = (select auth.uid())
      and membership.active
  );
$$;

create or replace function private.is_active_operations_device(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.shop_memberships membership
    join public.devices device
      on device.shop_id = membership.shop_id
     and device.auth_user_id = membership.auth_user_id
    where membership.shop_id = p_shop_id
      and membership.auth_user_id = (select auth.uid())
      and membership.role = 'OPERATIONS_DEVICE'
      and membership.active
      and device.active
  );
$$;

grant execute on function private.has_active_shop_membership(uuid) to authenticated;
grant execute on function private.is_active_operations_device(uuid) to authenticated;

-- Minimal read policies. Operational facts remain deny-by-default to clients; the
-- authenticated receiver is the only write path.
create policy shops_member_select
  on public.shops for select to authenticated
  using ((select private.has_active_shop_membership(id)));

create policy shop_memberships_self_select
  on public.shop_memberships for select to authenticated
  using (auth_user_id = (select auth.uid()) and active);

create policy devices_self_select
  on public.devices for select to authenticated
  using (auth_user_id = (select auth.uid()) and active);

create policy operations_configuration_device_select
  on public.operations_configuration_snapshots for select to authenticated
  using ((select private.is_active_operations_device(shop_id)));

-- Service-role-only administrative enrollment-code creation. The plaintext token is
-- returned once; only its SHA-256 digest is persisted.
create or replace function public.create_tux_device_enrollment(
  p_shop_id uuid,
  p_device_label text,
  p_ttl_minutes integer default 30
)
returns table(enrollment_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_code text;
  v_expires_at timestamptz;
begin
  if p_shop_id is null or not exists (
    select 1 from public.shops where id = p_shop_id and active
  ) then
    raise exception 'TUX_ENROLLMENT_SHOP_INVALID';
  end if;
  if btrim(coalesce(p_device_label, '')) = '' then
    raise exception 'TUX_ENROLLMENT_LABEL_INVALID';
  end if;
  if p_ttl_minutes < 5 or p_ttl_minutes > 1440 then
    raise exception 'TUX_ENROLLMENT_TTL_INVALID';
  end if;

  v_code := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(mins => p_ttl_minutes);

  insert into private.device_enrollment_codes(shop_id, token_hash, device_label, expires_at)
  values (
    p_shop_id,
    encode(extensions.digest(convert_to(v_code, 'UTF8'), 'sha256'), 'hex'),
    btrim(p_device_label),
    v_expires_at
  );

  return query select v_code, v_expires_at;
end;
$$;

revoke all on function public.create_tux_device_enrollment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.create_tux_device_enrollment(uuid, text, integer) to service_role;

create or replace function public.claim_tux_device_enrollment(p_enrollment_code text)
returns table(enrollment_id uuid, shop_id uuid, device_label text)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_hash text;
begin
  if length(coalesce(p_enrollment_code, '')) < 32 then
    raise exception 'TUX_ENROLLMENT_CODE_INVALID';
  end if;
  v_hash := encode(
    extensions.digest(convert_to(p_enrollment_code, 'UTF8'), 'sha256'),
    'hex'
  );

  return query
  update private.device_enrollment_codes enrollment
     set claimed_at = now()
   where enrollment.token_hash = v_hash
     and enrollment.claimed_at is null
     and enrollment.completed_at is null
     and enrollment.expires_at > now()
  returning enrollment.id, enrollment.shop_id, enrollment.device_label;

  if not found then
    raise exception 'TUX_ENROLLMENT_CODE_UNAVAILABLE';
  end if;
end;
$$;

revoke all on function public.claim_tux_device_enrollment(text) from public, anon, authenticated;
grant execute on function public.claim_tux_device_enrollment(text) to service_role;

create or replace function public.complete_tux_device_enrollment(
  p_enrollment_id uuid,
  p_auth_user_id uuid,
  p_device_id uuid,
  p_device_label text
)
returns table(shop_id uuid, device_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shop_id uuid;
  v_default_label text;
begin
  select enrollment.shop_id, enrollment.device_label
    into v_shop_id, v_default_label
  from private.device_enrollment_codes enrollment
  where enrollment.id = p_enrollment_id
    and enrollment.claimed_at is not null
    and enrollment.completed_at is null
    and enrollment.expires_at > now()
  for update;

  if v_shop_id is null then
    raise exception 'TUX_ENROLLMENT_CLAIM_INVALID';
  end if;
  if p_auth_user_id is null or not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'TUX_ENROLLMENT_AUTH_USER_INVALID';
  end if;
  if p_device_id is null then
    raise exception 'TUX_ENROLLMENT_DEVICE_ID_INVALID';
  end if;

  insert into public.shop_memberships(id, shop_id, auth_user_id, role, active)
  values (gen_random_uuid(), v_shop_id, p_auth_user_id, 'OPERATIONS_DEVICE', true)
  on conflict (shop_id, auth_user_id)
  do update set role = 'OPERATIONS_DEVICE', active = true;

  insert into public.devices(id, shop_id, label, active, auth_user_id)
  values (
    p_device_id,
    v_shop_id,
    coalesce(nullif(btrim(p_device_label), ''), v_default_label),
    true,
    p_auth_user_id
  );

  update private.device_enrollment_codes
     set completed_at = now(),
         completed_auth_user_id = p_auth_user_id,
         completed_device_id = p_device_id
   where id = p_enrollment_id;

  return query select v_shop_id, p_device_id;
end;
$$;

revoke all on function public.complete_tux_device_enrollment(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_tux_device_enrollment(uuid, uuid, uuid, text) to service_role;

-- Publish is intentionally service-role-only until the separate Admin product exists.
create or replace function public.publish_tux_operations_configuration(
  p_shop_id uuid,
  p_version integer,
  p_bundle_json jsonb,
  p_published_by_auth_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_version <= 0 then raise exception 'TUX_CONFIGURATION_VERSION_INVALID'; end if;
  if jsonb_typeof(p_bundle_json) <> 'object' then raise exception 'TUX_CONFIGURATION_BUNDLE_INVALID'; end if;
  if coalesce(p_bundle_json #>> '{snapshot,shopId}', '') <> p_shop_id::text then
    raise exception 'TUX_CONFIGURATION_SHOP_MISMATCH';
  end if;
  if coalesce((p_bundle_json #>> '{snapshot,version}')::integer, -1) <> p_version then
    raise exception 'TUX_CONFIGURATION_VERSION_MISMATCH';
  end if;

  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_by_auth_user_id
  ) values (p_shop_id, p_version, p_bundle_json, p_published_by_auth_user_id);
end;
$$;

revoke all on function public.publish_tux_operations_configuration(uuid, integer, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.publish_tux_operations_configuration(uuid, integer, jsonb, uuid) to service_role;

-- Internal helpers for the generic, trusted materialization plan emitted by the
-- canonical TypeScript V1 parser/materializer in the Operations sync Edge Function.
create or replace function private.tux_plan_table_allowed(p_table text)
returns boolean
language sql
immutable
as $$
  select p_table = any (array[
    'business_days',
    'worker_sessions',
    'customer_contacts',
    'orders',
    'order_items',
    'order_item_modifiers',
    'order_item_combo_beverages',
    'payments',
    'order_status_events',
    'expenses',
    'inventory_movements',
    'reconciliations',
    'reconciliation_lines'
  ]::text[]);
$$;

create or replace function private.tux_guard_allows(
  p_existing jsonb,
  p_guard jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_kind text;
  v_column text;
  v_current text;
  v_incoming text;
  v_current_rank integer;
  v_incoming_rank integer;
begin
  if p_existing is null then return true; end if;
  if p_guard is null or p_guard = 'null'::jsonb then return true; end if;

  v_kind := p_guard ->> 'kind';
  v_column := p_guard ->> 'column';
  v_current := p_existing ->> v_column;

  if v_kind = 'MONOTONIC_REVISION' then
    if v_current is null then return true; end if;
    return (p_guard ->> 'incomingRevision')::integer >= v_current::integer;
  elsif v_kind = 'MONOTONIC_TIMESTAMP' then
    v_incoming := p_guard ->> 'incomingTimestamp';
    if v_incoming is null then return v_current is null; end if;
    if v_current is null then return true; end if;
    return v_incoming::timestamptz >= v_current::timestamptz;
  elsif v_kind = 'STATE_RANK' then
    v_incoming := p_guard ->> 'incomingStatus';
    v_current_rank := (p_guard -> 'rank' ->> v_current)::integer;
    v_incoming_rank := (p_guard -> 'rank' ->> v_incoming)::integer;
    return v_current_rank is not null and v_incoming_rank is not null
      and v_incoming_rank >= v_current_rank;
  end if;

  raise exception 'TUX_SYNC_GUARD_INVALID';
end;
$$;

create or replace function private.apply_tux_remote_mutation(p_mutation jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_table text := p_mutation ->> 'table';
  v_mode text := p_mutation ->> 'mode';
  v_row jsonb := p_mutation -> 'row';
  v_guard jsonb := p_mutation -> 'guard';
  v_conflicts text[];
  v_columns text[];
  v_column text;
  v_column_list text := '';
  v_select_list text := '';
  v_update_list text := '';
  v_conflict_list text := '';
  v_match text := '';
  v_existing jsonb;
  v_sql text;
  v_first boolean := true;
  v_existing_found boolean := false;
begin
  if not private.tux_plan_table_allowed(v_table) then
    raise exception 'TUX_SYNC_TABLE_NOT_ALLOWED:%', coalesce(v_table, '<null>');
  end if;
  if v_mode not in ('UPSERT', 'UPDATE') then
    raise exception 'TUX_SYNC_MODE_INVALID';
  end if;
  if jsonb_typeof(v_row) <> 'object' then
    raise exception 'TUX_SYNC_ROW_INVALID';
  end if;

  select array_agg(value order by ordinality)
    into v_conflicts
  from jsonb_array_elements_text(p_mutation -> 'conflictColumns') with ordinality;
  if coalesce(array_length(v_conflicts, 1), 0) = 0 then
    raise exception 'TUX_SYNC_CONFLICT_COLUMNS_REQUIRED';
  end if;

  select array_agg(key order by key)
    into v_columns
  from jsonb_object_keys(v_row) as key;

  foreach v_column in array v_columns loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = v_table
        and attribute.attname = v_column
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      raise exception 'TUX_SYNC_COLUMN_NOT_ALLOWED:%.%', v_table, v_column;
    end if;

    if not v_first then
      v_column_list := v_column_list || ', ';
      v_select_list := v_select_list || ', ';
    end if;
    v_column_list := v_column_list || format('%I', v_column);
    v_select_list := v_select_list || format('r.%I', v_column);
    v_first := false;

    if not (v_column = any(v_conflicts)) then
      if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
      v_update_list := v_update_list || format('%I = excluded.%I', v_column, v_column);
    end if;
  end loop;

  foreach v_column in array v_conflicts loop
    if not (v_row ? v_column) then
      raise exception 'TUX_SYNC_CONFLICT_VALUE_MISSING:%', v_column;
    end if;
    if v_conflict_list <> '' then
      v_conflict_list := v_conflict_list || ', ';
      v_match := v_match || ' and ';
    end if;
    v_conflict_list := v_conflict_list || format('%I', v_column);
    v_match := v_match || format('t.%I is not distinct from r.%I', v_column, v_column);
  end loop;

  -- Serialize each materialized row identity so monotonic guards cannot race across
  -- concurrent requests for different higher-level aggregates.
  perform pg_advisory_xact_lock(
    hashtextextended(v_table || ':' || coalesce(v_conflicts::text, '') || ':' || coalesce(v_row::text, ''), 0)
  );

  v_sql := format(
    'select to_jsonb(t) from public.%I t, jsonb_populate_record(null::public.%I, $1) r where %s limit 1',
    v_table,
    v_table,
    v_match
  );
  execute v_sql into v_existing using v_row;
  v_existing_found := v_existing is not null;

  if v_existing_found and not private.tux_guard_allows(v_existing, v_guard) then
    return;
  end if;

  if v_mode = 'UPDATE' then
    if not v_existing_found then
      raise exception 'TUX_DEPENDENCY_MISSING:%.%', v_table, coalesce(v_conflicts::text, '');
    end if;
    -- UPDATE rows are intentionally partial; only keys present in the plan are changed.
    v_update_list := '';
    foreach v_column in array v_columns loop
      if not (v_column = any(v_conflicts)) then
        if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
        v_update_list := v_update_list || format('%I = r.%I', v_column, v_column);
      end if;
    end loop;
    if v_update_list = '' then return; end if;
    v_sql := format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where %s',
      v_table,
      v_update_list,
      v_table,
      v_match
    );
    execute v_sql using v_row;
    return;
  end if;

  if not v_existing_found then
    v_sql := format(
      'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) r',
      v_table,
      v_column_list,
      v_select_list,
      v_table
    );
    execute v_sql using v_row;
    return;
  end if;

  if v_update_list = '' then return; end if;
  -- The row is serialized and guard-checked above, so updating the existing identity is
  -- deterministic and cannot regress a newer revision/timestamp.
  v_update_list := '';
  foreach v_column in array v_columns loop
    if not (v_column = any(v_conflicts)) then
      if v_update_list <> '' then v_update_list := v_update_list || ', '; end if;
      v_update_list := v_update_list || format('%I = r.%I', v_column, v_column);
    end if;
  end loop;
  v_sql := format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where %s',
    v_table,
    v_update_list,
    v_table,
    v_match
  );
  execute v_sql using v_row;
end;
$$;

revoke all on function private.apply_tux_remote_mutation(jsonb) from public, anon, authenticated;

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

  -- Serialize receipt identity and aggregate stream before checking/applying.
  perform pg_advisory_xact_lock(hashtextextended('receipt:' || v_shop_id::text || ':' || v_event_id::text, 0));
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
    perform private.apply_tux_remote_mutation(v_mutation);
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
