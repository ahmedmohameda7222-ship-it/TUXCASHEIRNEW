-- TUX Admin Plan 2 shop, checkout, payment, receipt, and reason settings.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Existing Operations configuration snapshots remain the only device-facing configuration stream.

-- Make shop lifecycle and canonical contact/location explicit without replacing the existing shops table.
alter table public.shops add column if not exists lifecycle_state text;
update public.shops
set lifecycle_state = case when active then 'ACTIVE' else 'SUSPENDED' end
where lifecycle_state is null;
alter table public.shops alter column lifecycle_state set default 'ACTIVE';
alter table public.shops alter column lifecycle_state set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shops'::regclass and conname = 'shops_lifecycle_state_check'
  ) then
    alter table public.shops
      add constraint shops_lifecycle_state_check
      check (lifecycle_state in ('ACTIVE', 'SUSPENDED', 'ARCHIVED'));
  end if;
end $$;

alter table public.shops add column if not exists address_text text;
alter table public.shops add column if not exists contact_phone text;
alter table public.shops add column if not exists latitude numeric(9,6);
alter table public.shops add column if not exists longitude numeric(9,6);
alter table public.shops add column if not exists timezone text not null default 'Africa/Cairo';
alter table public.shops add column if not exists temporary_closed boolean not null default false;
alter table public.shops add column if not exists online_orders_paused boolean not null default false;
alter table public.shops add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shops'::regclass and conname = 'shops_timezone_check'
  ) then
    alter table public.shops
      add constraint shops_timezone_check check (timezone = 'Africa/Cairo');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shops'::regclass and conname = 'shops_latitude_check'
  ) then
    alter table public.shops
      add constraint shops_latitude_check check (latitude is null or latitude between -90 and 90);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shops'::regclass and conname = 'shops_longitude_check'
  ) then
    alter table public.shops
      add constraint shops_longitude_check check (longitude is null or longitude between -180 and 180);
  end if;
end $$;

-- Extend, do not duplicate, the canonical Operations payment-method rows.
alter table public.payment_methods add column if not exists channel text not null default 'BOTH';
alter table public.payment_methods add column if not exists requires_reference boolean not null default false;
alter table public.payment_methods add column if not exists manual_confirmation_required boolean not null default false;
alter table public.payment_methods add column if not exists refund_allowed boolean not null default true;
alter table public.payment_methods add column if not exists integration_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_methods'::regclass and conname = 'payment_methods_channel_check'
  ) then
    alter table public.payment_methods
      add constraint payment_methods_channel_check check (channel in ('POS', 'ONLINE', 'BOTH'));
  end if;
end $$;

create unique index if not exists payment_methods_shop_id_id_uq
  on public.payment_methods(shop_id, id);
create unique index if not exists delivery_zones_shop_id_id_uq
  on public.delivery_zones(shop_id, id);

-- Mutable management inputs. They are not device-facing until publish_shop_settings_v1 creates
-- an immutable published version and a matching Operations configuration snapshot.
create table public.business_setting_defaults (
  business_id uuid not null references public.businesses(id) on delete restrict,
  setting_key text not null check (setting_key ~ '^[A-Za-z][A-Za-z0-9_.-]*$'),
  value_json jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, setting_key),
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create table public.shop_setting_overrides (
  business_id uuid not null,
  shop_id uuid not null,
  setting_key text not null check (setting_key ~ '^[A-Za-z][A-Za-z0-9_.-]*$'),
  value_json jsonb not null,
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, setting_key),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create index shop_setting_overrides_business_shop_idx
  on public.shop_setting_overrides(business_id, shop_id, setting_key);

-- Immutable publication history. settings_json is the published settings payload that later
-- catalog publishes carry forward; mutable input rows can therefore never leak through a catalog publish.
create table public.shop_settings_versions (
  business_id uuid not null,
  shop_id uuid not null,
  settings_version bigint not null check (settings_version > 0),
  operations_configuration_version integer not null check (operations_configuration_version > 0),
  settings_json jsonb not null check (jsonb_typeof(settings_json) = 'object'),
  bundle_json jsonb not null check (jsonb_typeof(bundle_json) = 'object'),
  published_by_employee_id uuid not null,
  published_at timestamptz not null default now(),
  primary key (shop_id, settings_version),
  unique (shop_id, operations_configuration_version),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, published_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create index shop_settings_versions_latest_idx
  on public.shop_settings_versions(shop_id, settings_version desc);

-- One shared structured reason vocabulary. Shop rows override a same-key business reason in snapshots.
create table public.admin_reason_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  reason_key text not null check (reason_key ~ '^[a-z][a-z0-9_-]*$'),
  family text not null check (family in (
    'CANCELLATION',
    'REFUND_RETURN',
    'DISCOUNT_COMP',
    'WASTE',
    'STOCK_ADJUSTMENT',
    'CASH_VARIANCE',
    'PAY_IN',
    'PAY_OUT'
  )),
  label text not null check (btrim(label) <> ''),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create unique index admin_reason_codes_business_default_uq
  on public.admin_reason_codes(business_id, family, reason_key)
  where shop_id is null;
create unique index admin_reason_codes_shop_override_uq
  on public.admin_reason_codes(shop_id, family, reason_key)
  where shop_id is not null;
create index admin_reason_codes_business_family_idx
  on public.admin_reason_codes(business_id, family, active, reason_key);

-- Optional zone-level restrictions refine the payment method's shop/channel contract.
create table public.payment_method_zone_rules (
  business_id uuid not null,
  shop_id uuid not null,
  payment_method_id uuid not null,
  delivery_zone_id uuid not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (payment_method_id, delivery_zone_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (shop_id, payment_method_id)
    references public.payment_methods(shop_id, id) on delete restrict,
  foreign key (shop_id, delivery_zone_id)
    references public.delivery_zones(shop_id, id) on delete restrict
);
create index payment_method_zone_rules_shop_idx
  on public.payment_method_zone_rules(shop_id, delivery_zone_id, allowed);

-- Cairo-local recurring hours. An end earlier than start is intentionally an overnight window.
create table public.shop_weekly_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  service_kind text not null check (service_kind in ('OPEN', 'DELIVERY', 'ONLINE')),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  timezone text not null default 'Africa/Cairo' check (timezone = 'Africa/Cairo'),
  opens_local time without time zone not null,
  closes_local time without time zone not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  check (opens_local <> closes_local),
  unique (shop_id, service_kind, day_of_week, opens_local)
);
create index shop_weekly_hours_shop_service_idx
  on public.shop_weekly_hours(shop_id, service_kind, day_of_week, active);

create table public.shop_special_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  service_date date not null,
  service_kind text not null check (service_kind in ('OPEN', 'DELIVERY', 'ONLINE')),
  timezone text not null default 'Africa/Cairo' check (timezone = 'Africa/Cairo'),
  closed boolean not null default false,
  opens_local time without time zone,
  closes_local time without time zone,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  check (
    (closed and opens_local is null and closes_local is null)
    or
    (not closed and opens_local is not null and closes_local is not null and opens_local <> closes_local)
  ),
  unique (shop_id, service_kind, service_date)
);
create index shop_special_hours_shop_date_idx
  on public.shop_special_hours(shop_id, service_date, service_kind);

-- Admin-owned control tables are BFF/service-role only. Published Operations snapshots keep their
-- existing authenticated-device read policy; these mutable control rows never become browser-readable.
alter table public.business_setting_defaults enable row level security;
alter table public.shop_setting_overrides enable row level security;
alter table public.shop_settings_versions enable row level security;
alter table public.admin_reason_codes enable row level security;
alter table public.payment_method_zone_rules enable row level security;
alter table public.shop_weekly_hours enable row level security;
alter table public.shop_special_hours enable row level security;

revoke all on public.business_setting_defaults from public, anon, authenticated;
revoke all on public.shop_setting_overrides from public, anon, authenticated;
revoke all on public.shop_settings_versions from public, anon, authenticated;
revoke all on public.admin_reason_codes from public, anon, authenticated;
revoke all on public.payment_method_zone_rules from public, anon, authenticated;
revoke all on public.shop_weekly_hours from public, anon, authenticated;
revoke all on public.shop_special_hours from public, anon, authenticated;

create or replace function private.assert_admin_settings_permission_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_authorized boolean;
  v_business_id uuid;
  v_denial_code text;
begin
  select r.authorized, r.business_id, r.denial_code
    into v_authorized, v_business_id, v_denial_code
  from public.resolve_admin_authorization_v1(p_employee_id, p_shop_id, p_permission) r;

  if not coalesce(v_authorized, false) or v_business_id is null then
    raise exception 'TUX_ADMIN_SETTINGS_FORBIDDEN:%', coalesce(v_denial_code, 'unknown');
  end if;
  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    raise exception 'TUX_ADMIN_SETTINGS_SHOP_FORBIDDEN';
  end if;
  return v_business_id;
end;
$$;
revoke all on function private.assert_admin_settings_permission_v1(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.resolve_effective_shop_setting_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_setting_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_value jsonb;
  v_version bigint;
begin
  if p_business_id is null or p_shop_id is null or p_setting_key is null or btrim(p_setting_key) = '' then
    raise exception 'TUX_ADMIN_SETTING_REQUEST_INVALID';
  end if;
  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = p_business_id and bs.shop_id = p_shop_id
  ) then
    raise exception 'TUX_ADMIN_SETTING_SHOP_INVALID';
  end if;

  select s.value_json, s.version
    into v_value, v_version
  from public.shop_setting_overrides s
  where s.business_id = p_business_id
    and s.shop_id = p_shop_id
    and s.setting_key = p_setting_key;
  if found then
    return jsonb_build_object('source', 'shop', 'value', v_value, 'version', v_version);
  end if;

  select b.value_json, b.version
    into v_value, v_version
  from public.business_setting_defaults b
  where b.business_id = p_business_id
    and b.setting_key = p_setting_key;
  if found then
    return jsonb_build_object('source', 'business', 'value', v_value, 'version', v_version);
  end if;

  return jsonb_build_object('source', 'unset', 'value', null);
end;
$$;
revoke all on function public.resolve_effective_shop_setting_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_effective_shop_setting_v1(uuid, uuid, text)
  to service_role;

-- Build the complete settings payload from current trusted management state. This helper is used only
-- by settings publication. Catalog publication carries the latest immutable published payload instead.
create or replace function private.build_effective_shop_settings_payload_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_settings_version bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_business_values jsonb;
  v_shop_values jsonb;
  v_values jsonb;
  v_shop_identity jsonb;
  v_weekly jsonb;
  v_special jsonb;
  v_zone_rules jsonb;
  v_order_types jsonb;
  v_payment_methods jsonb;
  v_delivery_zones jsonb;
  v_reason_codes jsonb;
begin
  select coalesce(jsonb_object_agg(x.setting_key, x.value_json order by x.setting_key), '{}'::jsonb)
    into v_business_values
  from public.business_setting_defaults x
  where x.business_id = p_business_id;

  select coalesce(jsonb_object_agg(x.setting_key, x.value_json order by x.setting_key), '{}'::jsonb)
    into v_shop_values
  from public.shop_setting_overrides x
  where x.business_id = p_business_id and x.shop_id = p_shop_id;

  v_values := coalesce(v_business_values, '{}'::jsonb) || coalesce(v_shop_values, '{}'::jsonb);

  select jsonb_build_object(
      'shopId', s.id,
      'displayName', s.name,
      'address', s.address_text,
      'phone', s.contact_phone,
      'latitude', s.latitude,
      'longitude', s.longitude,
      'timezone', s.timezone,
      'lifecycleState', s.lifecycle_state,
      'temporaryClosed', s.temporary_closed,
      'onlineOrdersPaused', s.online_orders_paused
    )
    into v_shop_identity
  from public.shops s
  where s.id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id,
      'serviceKind', h.service_kind,
      'dayOfWeek', h.day_of_week,
      'timezone', h.timezone,
      'opensLocal', h.opens_local,
      'closesLocal', h.closes_local,
      'active', h.active
    ) order by h.service_kind, h.day_of_week, h.opens_local, h.id), '[]'::jsonb)
    into v_weekly
  from public.shop_weekly_hours h
  where h.business_id = p_business_id and h.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id,
      'serviceDate', h.service_date,
      'serviceKind', h.service_kind,
      'timezone', h.timezone,
      'closed', h.closed,
      'opensLocal', h.opens_local,
      'closesLocal', h.closes_local,
      'note', h.note
    ) order by h.service_date, h.service_kind, h.id), '[]'::jsonb)
    into v_special
  from public.shop_special_hours h
  where h.business_id = p_business_id and h.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'paymentMethodId', r.payment_method_id,
      'deliveryZoneId', r.delivery_zone_id,
      'allowed', r.allowed
    ) order by r.delivery_zone_id, r.payment_method_id), '[]'::jsonb)
    into v_zone_rules
  from public.payment_method_zone_rules r
  where r.business_id = p_business_id and r.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id,
      'shopId', o.shop_id,
      'name', o.name,
      'behavior', o.behavior,
      'active', o.active,
      'sortOrder', o.sort_order
    ) order by o.sort_order, o.id), '[]'::jsonb)
    into v_order_types
  from public.order_types o
  where o.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'shopId', p.shop_id,
      'displayName', p.display_name,
      'logicType', p.logic_type,
      'requiresReconciliation', p.requires_reconciliation,
      'active', p.active,
      'sortOrder', p.sort_order,
      'channel', p.channel,
      'requiresReference', p.requires_reference,
      'manualConfirmationRequired', p.manual_confirmation_required,
      'refundAllowed', p.refund_allowed,
      'integrationReference', p.integration_reference
    ) order by p.sort_order, p.id), '[]'::jsonb)
    into v_payment_methods
  from public.payment_methods p
  where p.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', z.id,
      'shopId', z.shop_id,
      'name', z.name,
      'feeMinor', z.fee_minor,
      'active', z.active,
      'sortOrder', z.sort_order
    ) order by z.sort_order, z.id), '[]'::jsonb)
    into v_delivery_zones
  from public.delivery_zones z
  where z.shop_id = p_shop_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'key', q.reason_key,
      'family', q.family,
      'label', q.label,
      'active', q.active,
      'version', q.version,
      'scope', case when q.shop_id is null then 'BUSINESS' else 'SHOP' end
    ) order by q.family, q.reason_key), '[]'::jsonb)
    into v_reason_codes
  from (
    select distinct on (r.family, r.reason_key)
      r.id, r.shop_id, r.reason_key, r.family, r.label, r.active, r.version
    from public.admin_reason_codes r
    where r.business_id = p_business_id
      and (r.shop_id is null or r.shop_id = p_shop_id)
    order by r.family, r.reason_key, (r.shop_id is not null) desc, r.version desc, r.id
  ) q;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'version', p_settings_version,
      'values', v_values,
      'shopIdentity', coalesce(v_shop_identity, '{}'::jsonb),
      'weeklyHours', v_weekly,
      'specialHours', v_special,
      'paymentMethodZoneRules', v_zone_rules
    ),
    'orderTypes', v_order_types,
    'paymentMethods', v_payment_methods,
    'deliveryZones', v_delivery_zones,
    'reasonCodes', v_reason_codes
  );
end;
$$;
revoke all on function private.build_effective_shop_settings_payload_v1(uuid, uuid, bigint)
  from public, anon, authenticated;

create or replace function private.merge_admin_settings_bundle_v1(
  p_base_bundle jsonb,
  p_settings_payload jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb := p_base_bundle;
begin
  if p_settings_payload is null then
    return v_result;
  end if;
  v_result := jsonb_set(v_result, '{snapshot,settings}', p_settings_payload -> 'settings', true);
  v_result := jsonb_set(v_result, '{snapshot,orderTypes}', p_settings_payload -> 'orderTypes', true);
  v_result := jsonb_set(v_result, '{snapshot,paymentMethods}', p_settings_payload -> 'paymentMethods', true);
  v_result := jsonb_set(v_result, '{snapshot,deliveryZones}', p_settings_payload -> 'deliveryZones', true);
  v_result := jsonb_set(v_result, '{snapshot,reasonCodes}', p_settings_payload -> 'reasonCodes', true);
  return v_result;
end;
$$;
revoke all on function private.merge_admin_settings_bundle_v1(jsonb, jsonb)
  from public, anon, authenticated;

-- Preserve the proven catalog builder as a core implementation, then wrap its public private-name
-- with the latest immutable published settings. Existing catalog RPCs continue calling the same name.
alter function private.build_admin_catalog_bundle_v1(uuid, integer, timestamptz)
  rename to build_admin_catalog_core_bundle_v1;
revoke all on function private.build_admin_catalog_core_bundle_v1(uuid, integer, timestamptz)
  from public, anon, authenticated;

create or replace function private.build_admin_catalog_bundle_v1(
  p_shop_id uuid,
  p_version integer,
  p_updated_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_base jsonb;
  v_settings_payload jsonb;
begin
  v_base := private.build_admin_catalog_core_bundle_v1(p_shop_id, p_version, p_updated_at);

  select s.settings_json
    into v_settings_payload
  from public.shop_settings_versions s
  where s.shop_id = p_shop_id
  order by s.settings_version desc
  limit 1;

  if v_settings_payload is null then
    return v_base;
  end if;
  return private.merge_admin_settings_bundle_v1(v_base, v_settings_payload);
end;
$$;
revoke all on function private.build_admin_catalog_bundle_v1(uuid, integer, timestamptz)
  from public, anon, authenticated;

create or replace function public.publish_shop_settings_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_settings_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_operations_version integer;
  v_next_settings_version bigint;
  v_next_operations_version integer;
  v_payload jsonb;
  v_base jsonb;
  v_bundle jsonb;
  v_now timestamptz := now();
begin
  if p_expected_settings_version is null or p_expected_settings_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_expected_version');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );

  -- Share the exact shop-level serialization key with catalog publishing so the one Operations
  -- configuration version stream cannot allocate the same version concurrently.
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  if not exists (
    select 1 from public.shops s
    where s.id = p_shop_id and s.lifecycle_state <> 'ARCHIVED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_archived_or_missing');
  end if;

  select coalesce(max(s.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions s
  where s.shop_id = p_shop_id;

  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  v_next_settings_version := v_current_settings_version + 1;
  v_next_operations_version := v_current_operations_version + 1;
  v_payload := private.build_effective_shop_settings_payload_v1(
    v_business_id, p_shop_id, v_next_settings_version
  );
  v_base := private.build_admin_catalog_core_bundle_v1(
    p_shop_id, v_next_operations_version, v_now
  );
  v_bundle := private.merge_admin_settings_bundle_v1(v_base, v_payload);

  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values (
    p_shop_id, v_next_operations_version, v_bundle, v_now, null
  );

  insert into public.shop_settings_versions(
    business_id, shop_id, settings_version, operations_configuration_version,
    settings_json, bundle_json, published_by_employee_id, published_at
  ) values (
    v_business_id, p_shop_id, v_next_settings_version, v_next_operations_version,
    v_payload, v_bundle, p_employee_id, v_now
  );

  return jsonb_build_object(
    'ok', true,
    'settingsVersion', v_next_settings_version,
    'operationsConfigurationVersion', v_next_operations_version
  );
end;
$$;
revoke all on function public.publish_shop_settings_v1(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.publish_shop_settings_v1(uuid, uuid, bigint)
  to service_role;

create or replace function public.delete_or_archive_shop_v1(
  p_employee_id uuid,
  p_shop_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_business_id uuid;
  v_used boolean;
begin
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'shops.manage'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  perform 1 from public.shops s where s.id = p_shop_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select (
    exists (select 1 from public.business_days x where x.shop_id = p_shop_id)
    or exists (select 1 from public.orders x where x.shop_id = p_shop_id)
    or exists (select 1 from public.operations_configuration_snapshots x where x.shop_id = p_shop_id)
    or exists (select 1 from public.menu_categories x where x.shop_id = p_shop_id)
    or exists (select 1 from public.products x where x.shop_id = p_shop_id)
    or exists (select 1 from public.modifiers x where x.shop_id = p_shop_id)
    or exists (select 1 from public.inventory_items x where x.shop_id = p_shop_id)
    or exists (select 1 from public.order_types x where x.shop_id = p_shop_id)
    or exists (select 1 from public.payment_methods x where x.shop_id = p_shop_id)
    or exists (select 1 from public.delivery_zones x where x.shop_id = p_shop_id)
    or exists (select 1 from public.customer_contacts x where x.shop_id = p_shop_id)
    or exists (select 1 from public.devices x where x.shop_id = p_shop_id)
    or exists (select 1 from public.workers x where x.shop_id = p_shop_id)
    or exists (select 1 from public.shop_memberships x where x.shop_id = p_shop_id)
    or exists (select 1 from public.catalog_category_shop_bindings x where x.shop_id = p_shop_id)
    or exists (select 1 from public.catalog_product_shop_overrides x where x.shop_id = p_shop_id)
    or exists (select 1 from public.catalog_drafts x where x.shop_id = p_shop_id)
    or exists (select 1 from public.catalog_publish_versions x where x.shop_id = p_shop_id)
    or exists (select 1 from public.scheduled_config_changes x where x.shop_id = p_shop_id)
    or exists (select 1 from public.recurring_availability_rules x where x.shop_id = p_shop_id)
    or exists (select 1 from public.shop_setting_overrides x where x.shop_id = p_shop_id)
    or exists (select 1 from public.shop_settings_versions x where x.shop_id = p_shop_id)
    or exists (select 1 from public.admin_reason_codes x where x.shop_id = p_shop_id)
    or exists (select 1 from public.payment_method_zone_rules x where x.shop_id = p_shop_id)
    or exists (select 1 from public.shop_weekly_hours x where x.shop_id = p_shop_id)
    or exists (select 1 from public.shop_special_hours x where x.shop_id = p_shop_id)
  ) into v_used;

  if v_used then
    update public.shops
    set lifecycle_state = 'ARCHIVED', active = false, updated_at = now()
    where id = p_shop_id;
    return jsonb_build_object('ok', true, 'action', 'ARCHIVED');
  end if;

  delete from public.business_shops
  where business_id = v_business_id and shop_id = p_shop_id;
  delete from public.shops where id = p_shop_id;
  return jsonb_build_object('ok', true, 'action', 'DELETED');
end;
$$;
revoke all on function public.delete_or_archive_shop_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_or_archive_shop_v1(uuid, uuid)
  to service_role;
