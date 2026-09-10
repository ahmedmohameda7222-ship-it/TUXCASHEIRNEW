-- TUX Admin Plan 1 business identity, human authorization, and secure session foundation.
-- Repository migration only. Do not apply to a remote project without explicit target authorization.
-- Existing Operations shops/workers/memberships remain canonical and are not recreated here.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  timezone text not null default 'Africa/Cairo' check (btrim(timezone) <> ''),
  currency_code text not null default 'EGP' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_shops (
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (business_id, shop_id),
  unique (shop_id)
);

create table if not exists public.business_employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  role text not null check (role in ('OWNER', 'ADMIN', 'MANAGER', 'STAFF')),
  pin_lookup_hash text check (pin_lookup_hash is null or pin_lookup_hash ~ '^[0-9a-f]{64}$'),
  pin_hash text check (pin_hash is null or btrim(pin_hash) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check ((pin_lookup_hash is null) = (pin_hash is null))
);

-- PIN alone identifies an Admin human, so an active lookup digest cannot identify two people.
create unique index if not exists business_employees_active_pin_lookup_uq
  on public.business_employees(pin_lookup_hash)
  where active and pin_lookup_hash is not null;

create index if not exists business_employees_business_active_idx
  on public.business_employees(business_id, active, role);

create table if not exists public.employee_shop_assignments (
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, shop_id),
  foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete cascade,
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete cascade
);

create index if not exists employee_shop_assignments_business_shop_idx
  on public.employee_shop_assignments(business_id, shop_id, employee_id);

create table if not exists public.admin_permissions (
  permission_key text primary key check (permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_role_permissions (
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'MANAGER', 'STAFF')),
  permission_key text not null references public.admin_permissions(permission_key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (business_id, role, permission_key)
);

create table if not exists public.admin_employee_permissions (
  business_id uuid not null,
  employee_id uuid not null,
  permission_key text not null references public.admin_permissions(permission_key) on delete restrict,
  effect text not null check (effect in ('ALLOW', 'DENY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, permission_key),
  foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete cascade
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token_hash text not null check (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  reauthenticated_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete cascade,
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at),
  check (reauthenticated_at is null or reauthenticated_at >= created_at)
);

create index if not exists admin_sessions_employee_active_idx
  on public.admin_sessions(employee_id, expires_at desc)
  where revoked_at is null;

-- HMAC-derived request/client keys only. Never persist raw IP addresses or user agents.
create table if not exists private.admin_pin_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

create index if not exists admin_pin_rate_limits_window_idx
  on private.admin_pin_rate_limits(window_started_at);

revoke all on private.admin_pin_rate_limits from public, anon, authenticated;

-- Stable reviewed permission taxonomy. Keep this in lockstep with @tux/admin-contracts.
insert into public.admin_permissions(permission_key)
values
  ('orders.view'),
  ('orders.manage'),
  ('orders.cancel'),
  ('orders.refund'),
  ('catalog.view'),
  ('catalog.edit'),
  ('catalog.pricing'),
  ('catalog.publish'),
  ('inventory.view'),
  ('inventory.adjust'),
  ('inventory.stocktake'),
  ('inventory.transfer'),
  ('inventory.override_negative'),
  ('purchasing.view'),
  ('purchasing.manage'),
  ('purchasing.receive'),
  ('customers.view'),
  ('customers.manage'),
  ('customers.merge'),
  ('loyalty.manage'),
  ('promotions.manage'),
  ('staff.view'),
  ('staff.manage'),
  ('staff.payments'),
  ('delivery.view'),
  ('delivery.manage'),
  ('finance.view'),
  ('finance.adjust'),
  ('finance.reconcile'),
  ('finance.manage_accounts'),
  ('reports.view'),
  ('alerts.view'),
  ('shops.manage'),
  ('devices.view'),
  ('devices.manage'),
  ('settings.manage'),
  ('whatsapp.view'),
  ('whatsapp.manage'),
  ('audit.view'),
  ('approvals.review')
on conflict (permission_key) do nothing;

-- The existing installation is one TUX business. The deterministic identity makes the
-- migration idempotent while preserving every existing canonical shop id.
insert into public.businesses(id, name, timezone, currency_code)
values ('00000000-0000-4000-8000-000000000001', 'TUX', 'Africa/Cairo', 'EGP')
on conflict (id) do nothing;

insert into public.business_shops(business_id, shop_id)
select '00000000-0000-4000-8000-000000000001'::uuid, s.id
from public.shops s
where not exists (
  select 1 from public.business_shops bs where bs.shop_id = s.id
)
on conflict (shop_id) do nothing;

-- OWNER is semantically all-permissions in the resolver. Seed explicit rows as useful
-- introspection, and conservative presets for the other built-in roles.
insert into public.admin_role_permissions(business_id, role, permission_key)
select '00000000-0000-4000-8000-000000000001'::uuid, 'OWNER', p.permission_key
from public.admin_permissions p
on conflict do nothing;

insert into public.admin_role_permissions(business_id, role, permission_key)
select '00000000-0000-4000-8000-000000000001'::uuid, 'ADMIN', p.permission_key
from public.admin_permissions p
where p.permission_key <> 'inventory.override_negative'
on conflict do nothing;

insert into public.admin_role_permissions(business_id, role, permission_key)
select '00000000-0000-4000-8000-000000000001'::uuid, 'MANAGER', p.permission_key
from public.admin_permissions p
where p.permission_key in (
  'orders.view', 'orders.manage', 'orders.cancel',
  'catalog.view',
  'inventory.view', 'inventory.adjust', 'inventory.stocktake', 'inventory.transfer',
  'purchasing.view', 'purchasing.manage', 'purchasing.receive',
  'customers.view', 'customers.manage',
  'staff.view',
  'delivery.view', 'delivery.manage',
  'reports.view', 'alerts.view',
  'devices.view',
  'whatsapp.view'
)
on conflict do nothing;

insert into public.admin_role_permissions(business_id, role, permission_key)
select '00000000-0000-4000-8000-000000000001'::uuid, 'STAFF', p.permission_key
from public.admin_permissions p
where p.permission_key in (
  'orders.view', 'catalog.view', 'inventory.view', 'customers.view',
  'delivery.view', 'alerts.view'
)
on conflict do nothing;

create or replace function public.resolve_admin_authorization_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns table(
  authorized boolean,
  business_id uuid,
  employee_role text,
  denial_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_business_id uuid;
  v_role text;
  v_active boolean;
  v_override text;
begin
  if p_employee_id is null or p_permission is null or btrim(p_permission) = '' then
    return query select false, null::uuid, null::text, 'invalid_request'::text;
    return;
  end if;

  if not exists (
    select 1 from public.admin_permissions p where p.permission_key = p_permission
  ) then
    return query select false, null::uuid, null::text, 'unknown_permission'::text;
    return;
  end if;

  select e.business_id, e.role, e.active
    into v_business_id, v_role, v_active
  from public.business_employees e
  where e.id = p_employee_id;

  if not found or not coalesce(v_active, false) then
    return query select false, v_business_id, v_role, 'employee_inactive_or_missing'::text;
    return;
  end if;

  if p_shop_id is not null then
    if not exists (
      select 1
      from public.business_shops bs
      where bs.business_id = v_business_id and bs.shop_id = p_shop_id
    ) then
      return query select false, v_business_id, v_role, 'shop_outside_business'::text;
      return;
    end if;

    if v_role <> 'OWNER' and not exists (
      select 1
      from public.employee_shop_assignments esa
      where esa.business_id = v_business_id
        and esa.employee_id = p_employee_id
        and esa.shop_id = p_shop_id
    ) then
      return query select false, v_business_id, v_role, 'shop_not_assigned'::text;
      return;
    end if;
  end if;

  if v_role = 'OWNER' then
    return query select true, v_business_id, v_role, null::text;
    return;
  end if;

  select ep.effect
    into v_override
  from public.admin_employee_permissions ep
  where ep.business_id = v_business_id
    and ep.employee_id = p_employee_id
    and ep.permission_key = p_permission;

  if v_override = 'DENY' then
    return query select false, v_business_id, v_role, 'permission_denied'::text;
    return;
  end if;
  if v_override = 'ALLOW' then
    return query select true, v_business_id, v_role, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.admin_role_permissions rp
    where rp.business_id = v_business_id
      and rp.role = v_role
      and rp.permission_key = p_permission
  ) then
    return query select true, v_business_id, v_role, null::text;
  else
    return query select false, v_business_id, v_role, 'permission_denied'::text;
  end if;
end;
$$;

create or replace function public.claim_tux_admin_pin_attempt(
  p_rate_key text,
  p_max_attempts integer default 8,
  p_window_seconds integer default 900
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := now();
  v_window_started_at timestamptz;
  v_attempt_count integer;
  v_retry numeric;
begin
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'TUX_ADMIN_PIN_RATE_KEY_INVALID';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'TUX_ADMIN_PIN_RATE_LIMIT_INVALID';
  end if;
  if p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'TUX_ADMIN_PIN_RATE_WINDOW_INVALID';
  end if;

  insert into private.admin_pin_rate_limits(rate_key, window_started_at, attempt_count)
  values (p_rate_key, v_now, 1)
  on conflict (rate_key) do update set
    window_started_at = case
      when private.admin_pin_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
        then v_now
      else private.admin_pin_rate_limits.window_started_at
    end,
    attempt_count = case
      when private.admin_pin_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
        then 1
      else private.admin_pin_rate_limits.attempt_count + 1
    end
  returning window_started_at, attempt_count
    into v_window_started_at, v_attempt_count;

  allowed := v_attempt_count <= p_max_attempts;
  if allowed then
    retry_after_seconds := 0;
  else
    v_retry := extract(
      epoch from (
        v_window_started_at + make_interval(secs => p_window_seconds) - v_now
      )
    );
    retry_after_seconds := greatest(1, ceil(v_retry)::integer);
  end if;
  return next;
end;
$$;

create or replace function public.clear_tux_admin_pin_attempts(p_rate_key text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'TUX_ADMIN_PIN_RATE_KEY_INVALID';
  end if;
  delete from private.admin_pin_rate_limits where rate_key = p_rate_key;
end;
$$;

-- Admin-owned data has no direct browser policy. Trusted server RPCs are the boundary.
alter table public.businesses enable row level security;
alter table public.business_shops enable row level security;
alter table public.business_employees enable row level security;
alter table public.employee_shop_assignments enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_employee_permissions enable row level security;
alter table public.admin_sessions enable row level security;

revoke all on table public.businesses from public, anon, authenticated;
revoke all on table public.business_shops from public, anon, authenticated;
revoke all on table public.business_employees from public, anon, authenticated;
revoke all on table public.employee_shop_assignments from public, anon, authenticated;
revoke all on table public.admin_permissions from public, anon, authenticated;
revoke all on table public.admin_role_permissions from public, anon, authenticated;
revoke all on table public.admin_employee_permissions from public, anon, authenticated;
revoke all on table public.admin_sessions from public, anon, authenticated;

revoke all on function public.resolve_admin_authorization_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_admin_authorization_v1(uuid, uuid, text)
  to service_role;

revoke all on function public.claim_tux_admin_pin_attempt(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_tux_admin_pin_attempt(text, integer, integer)
  to service_role;

revoke all on function public.clear_tux_admin_pin_attempts(text)
  from public, anon, authenticated;
grant execute on function public.clear_tux_admin_pin_attempts(text)
  to service_role;
