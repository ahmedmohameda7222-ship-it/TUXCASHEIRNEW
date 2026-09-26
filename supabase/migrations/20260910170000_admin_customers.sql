-- TUX Admin Plan 5: canonical business customers, shop links, addresses, segments, and safe merge.
-- Repository migration only. Do not apply to a remote project during implementation Plans 5-9.

create or replace function private.canonicalize_egypt_customer_phone_v1(p_phone text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $canonicalize$
declare
  v_phone text := regexp_replace(coalesce(btrim(p_phone), ''), '[[:space:]()-]', '', 'g');
begin
  if left(v_phone, 3) = '+20' then
    null;
  elsif left(v_phone, 4) = '0020' then
    v_phone := '+20' || substr(v_phone, 5);
  elsif left(v_phone, 2) = '20' then
    v_phone := '+' || v_phone;
  elsif left(v_phone, 1) = '0' then
    v_phone := '+20' || substr(v_phone, 2);
  else
    return null;
  end if;

  if left(v_phone, 3) <> '+20'
     or substr(v_phone, 4) !~ '^(10|11|12|15)[0-9]{8}$' then
    return null;
  end if;
  return v_phone;
end;
$canonicalize$;

revoke all on function private.canonicalize_egypt_customer_phone_v1(text)
  from public, anon, authenticated;

create table public.business_customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  normalized_phone text not null check (btrim(normalized_phone) <> ''),
  display_name text,
  merged_into_customer_id uuid references public.business_customers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, normalized_phone),
  unique (business_id, id),
  check (merged_into_customer_id is null or merged_into_customer_id <> id)
);

create table public.customer_shop_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  canonical_customer_id uuid not null references public.business_customers(id) on delete restrict,
  legacy_customer_contact_id uuid references public.customer_contacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (legacy_customer_contact_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  canonical_customer_id uuid not null references public.business_customers(id) on delete restrict,
  shop_id uuid references public.shops(id) on delete restrict,
  address_text text not null check (btrim(address_text) <> ''),
  delivery_zone_id uuid references public.delivery_zones(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (canonical_customer_id, address_text)
);

create table public.customer_segments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  canonical_customer_id uuid not null references public.business_customers(id) on delete restrict,
  segment_key text not null check (btrim(segment_key) <> ''),
  assigned_at timestamptz not null default now(),
  source text not null default 'SYSTEM' check (source in ('SYSTEM', 'MANUAL')),
  unique (canonical_customer_id, segment_key)
);

create table public.admin_customer_merge_receipts (
  business_id uuid not null references public.businesses(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  survivor_customer_id uuid not null references public.business_customers(id) on delete restrict,
  merged_customer_id uuid not null references public.business_customers(id) on delete restrict,
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz not null default now(),
  primary key (business_id, command_id)
);

alter table public.customer_contacts
  add column if not exists canonical_customer_id uuid
    references public.business_customers(id) on delete restrict;

insert into public.business_customers(business_id, normalized_phone, display_name)
select
  bs.business_id,
  private.canonicalize_egypt_customer_phone_v1(c.normalized_phone),
  max(nullif(btrim(c.name), ''))
from public.customer_contacts c
join public.business_shops bs on bs.shop_id = c.shop_id
where private.canonicalize_egypt_customer_phone_v1(c.normalized_phone) is not null
group by bs.business_id, private.canonicalize_egypt_customer_phone_v1(c.normalized_phone)
on conflict (business_id, normalized_phone) do update
set display_name = coalesce(public.business_customers.display_name, excluded.display_name),
    updated_at = now();

update public.customer_contacts c
set canonical_customer_id = coalesce(bc.merged_into_customer_id, bc.id)
from public.business_shops bs
join public.business_customers bc on bc.business_id = bs.business_id
where bs.shop_id = c.shop_id
  and bc.normalized_phone = private.canonicalize_egypt_customer_phone_v1(c.normalized_phone)
  and c.canonical_customer_id is distinct from coalesce(bc.merged_into_customer_id, bc.id);

insert into public.customer_shop_links(
  business_id, shop_id, canonical_customer_id, legacy_customer_contact_id
)
select
  bs.business_id,
  c.shop_id,
  c.canonical_customer_id,
  c.id
from public.customer_contacts c
join public.business_shops bs on bs.shop_id = c.shop_id
where c.canonical_customer_id is not null
on conflict (legacy_customer_contact_id) do nothing;

insert into public.customer_addresses(
  business_id, canonical_customer_id, shop_id, address_text, delivery_zone_id, last_used_at
)
select
  bs.business_id,
  c.canonical_customer_id,
  c.shop_id,
  btrim(c.latest_address),
  c.latest_zone_id,
  c.last_order_at
from public.customer_contacts c
join public.business_shops bs on bs.shop_id = c.shop_id
where c.canonical_customer_id is not null
  and nullif(btrim(c.latest_address), '') is not null
on conflict (canonical_customer_id, address_text) do update
set last_used_at = greatest(
      coalesce(public.customer_addresses.last_used_at, '-infinity'::timestamptz),
      coalesce(excluded.last_used_at, '-infinity'::timestamptz)
    ),
    delivery_zone_id = coalesce(excluded.delivery_zone_id, public.customer_addresses.delivery_zone_id);

create or replace function private.sync_customer_contact_canonical_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $sync_customer$
declare
  v_business_id uuid;
  v_phone text;
  v_customer_id uuid;
begin
  select bs.business_id
    into v_business_id
  from public.business_shops bs
  where bs.shop_id = new.shop_id
  limit 1;

  v_phone := private.canonicalize_egypt_customer_phone_v1(new.normalized_phone);
  if v_business_id is null or v_phone is null then
    new.canonical_customer_id := null;
    return new;
  end if;

  insert into public.business_customers(business_id, normalized_phone, display_name, updated_at)
  values (v_business_id, v_phone, nullif(btrim(new.name), ''), now())
  on conflict (business_id, normalized_phone) do update
  set display_name = coalesce(nullif(btrim(excluded.display_name), ''), public.business_customers.display_name),
      updated_at = now()
  returning coalesce(merged_into_customer_id, id) into v_customer_id;

  new.canonical_customer_id := v_customer_id;
  return new;
end;
$sync_customer$;

revoke all on function private.sync_customer_contact_canonical_v1()
  from public, anon, authenticated;

drop trigger if exists customer_contacts_canonical_identity
  on public.customer_contacts;
create trigger customer_contacts_canonical_identity
before insert or update of shop_id, normalized_phone, name on public.customer_contacts
for each row execute function private.sync_customer_contact_canonical_v1();

create or replace function private.sync_customer_contact_link_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $sync_customer_link$
declare
  v_business_id uuid;
begin
  if new.canonical_customer_id is null then
    return new;
  end if;

  select bs.business_id into v_business_id
  from public.business_shops bs
  where bs.shop_id = new.shop_id
  limit 1;

  insert into public.customer_shop_links(
    business_id, shop_id, canonical_customer_id, legacy_customer_contact_id
  )
  values (v_business_id, new.shop_id, new.canonical_customer_id, new.id)
  on conflict (legacy_customer_contact_id) do update
  set business_id = excluded.business_id,
      shop_id = excluded.shop_id,
      canonical_customer_id = excluded.canonical_customer_id;

  if nullif(btrim(new.latest_address), '') is not null then
    insert into public.customer_addresses(
      business_id, canonical_customer_id, shop_id, address_text, delivery_zone_id, last_used_at
    )
    values (
      v_business_id,
      new.canonical_customer_id,
      new.shop_id,
      btrim(new.latest_address),
      new.latest_zone_id,
      new.last_order_at
    )
    on conflict (canonical_customer_id, address_text) do update
    set last_used_at = greatest(
          coalesce(public.customer_addresses.last_used_at, '-infinity'::timestamptz),
          coalesce(excluded.last_used_at, '-infinity'::timestamptz)
        ),
        delivery_zone_id = coalesce(excluded.delivery_zone_id, public.customer_addresses.delivery_zone_id);
  end if;

  return new;
end;
$sync_customer_link$;

revoke all on function private.sync_customer_contact_link_v1()
  from public, anon, authenticated;

drop trigger if exists customer_contacts_canonical_link
  on public.customer_contacts;
create trigger customer_contacts_canonical_link
after insert or update of shop_id, normalized_phone, name, latest_address, latest_zone_id, last_order_at
on public.customer_contacts
for each row execute function private.sync_customer_contact_link_v1();

alter table public.business_customers enable row level security;
alter table public.customer_shop_links enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.customer_segments enable row level security;
alter table public.admin_customer_merge_receipts enable row level security;

revoke all on public.business_customers from public, anon, authenticated;
revoke all on public.customer_shop_links from public, anon, authenticated;
revoke all on public.customer_addresses from public, anon, authenticated;
revoke all on public.customer_segments from public, anon, authenticated;
revoke all on public.admin_customer_merge_receipts from public, anon, authenticated;

grant select, insert, update on public.business_customers to service_role;
grant select, insert, update, delete on public.customer_shop_links to service_role;
grant select, insert, update, delete on public.customer_addresses to service_role;
grant select, insert, update, delete on public.customer_segments to service_role;
grant select, insert on public.admin_customer_merge_receipts to service_role;

create or replace function public.merge_admin_customers_v1(
  p_employee_id uuid,
  p_business_id uuid,
  p_survivor_customer_id uuid,
  p_merged_customer_id uuid,
  p_confirmed boolean,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $merge_customers$
declare
  v_role text;
  v_receipt public.admin_customer_merge_receipts%rowtype;
  v_survivor public.business_customers%rowtype;
  v_merged public.business_customers%rowtype;
  v_result jsonb;
begin
  if not coalesce(p_confirmed, false) then
    raise exception 'TUX_ADMIN_CUSTOMER_MERGE_CONFIRMATION_REQUIRED';
  end if;
  if p_survivor_customer_id = p_merged_customer_id then
    raise exception 'TUX_ADMIN_CUSTOMER_MERGE_SAME_IDENTITY';
  end if;
  if nullif(btrim(p_command_id), '') is null then
    raise exception 'TUX_ADMIN_CUSTOMER_COMMAND_ID_REQUIRED';
  end if;

  select e.role into v_role
  from public.business_employees e
  where e.id = p_employee_id
    and e.business_id = p_business_id
    and e.active
  limit 1;

  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception 'TUX_ADMIN_CUSTOMER_PERMISSION_REQUIRED:customers.merge';
  end if;

  if v_role <> 'OWNER' and (
    not (
      exists (
        select 1
        from public.admin_role_permissions rp
        where rp.business_id = p_business_id
          and rp.role = v_role
          and rp.permission_key = 'customers.merge'
      )
      or exists (
        select 1
        from public.admin_employee_permissions ep
        where ep.business_id = p_business_id
          and ep.employee_id = p_employee_id
          and ep.permission_key = 'customers.merge'
          and ep.effect = 'ALLOW'
      )
    )
    or exists (
      select 1
      from public.admin_employee_permissions ep
      where ep.business_id = p_business_id
        and ep.employee_id = p_employee_id
        and ep.permission_key = 'customers.merge'
        and ep.effect = 'DENY'
    )
  ) then
    raise exception 'TUX_ADMIN_CUSTOMER_PERMISSION_REQUIRED:customers.merge';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('admin-customer-merge:' || p_business_id::text || ':' || p_command_id, 0)
  );

  select * into v_receipt
  from public.admin_customer_merge_receipts r
  where r.business_id = p_business_id
    and r.command_id = p_command_id;
  if found then
    if v_receipt.survivor_customer_id <> p_survivor_customer_id
       or v_receipt.merged_customer_id <> p_merged_customer_id then
      raise exception 'TUX_ADMIN_CUSTOMER_COMMAND_CONFLICT';
    end if;
    return v_receipt.result_json || jsonb_build_object('replayed', true);
  end if;

  perform 1
  from public.business_customers c
  where c.business_id = p_business_id
    and c.id in (p_survivor_customer_id, p_merged_customer_id)
  order by c.id
  for update;

  select * into v_survivor
  from public.business_customers c
  where c.business_id = p_business_id
    and c.id = p_survivor_customer_id;

  select * into v_merged
  from public.business_customers c
  where c.business_id = p_business_id
    and c.id = p_merged_customer_id;

  if v_survivor.id is null or v_merged.id is null then
    raise exception 'TUX_ADMIN_CUSTOMER_NOT_FOUND';
  end if;
  if v_survivor.merged_into_customer_id is not null
     or v_merged.merged_into_customer_id is not null then
    raise exception 'TUX_ADMIN_CUSTOMER_ALREADY_MERGED';
  end if;

  insert into public.customer_shop_links(
    business_id, shop_id, canonical_customer_id, legacy_customer_contact_id, created_at
  )
  select
    l.business_id,
    l.shop_id,
    p_survivor_customer_id,
    l.legacy_customer_contact_id,
    l.created_at
  from public.customer_shop_links l
  where l.business_id = p_business_id
    and l.canonical_customer_id = p_merged_customer_id
  on conflict (legacy_customer_contact_id) do update
  set canonical_customer_id = excluded.canonical_customer_id;

  delete from public.customer_shop_links
  where business_id = p_business_id
    and canonical_customer_id = p_merged_customer_id;

  update public.customer_contacts
  set canonical_customer_id = p_survivor_customer_id
  where canonical_customer_id = p_merged_customer_id;

  insert into public.customer_addresses(
    business_id, canonical_customer_id, shop_id, address_text,
    delivery_zone_id, created_at, last_used_at
  )
  select
    business_id,
    p_survivor_customer_id,
    shop_id,
    address_text,
    delivery_zone_id,
    created_at,
    last_used_at
  from public.customer_addresses
  where business_id = p_business_id
    and canonical_customer_id = p_merged_customer_id
  on conflict (canonical_customer_id, address_text) do update
  set last_used_at = greatest(
        coalesce(public.customer_addresses.last_used_at, '-infinity'::timestamptz),
        coalesce(excluded.last_used_at, '-infinity'::timestamptz)
      ),
      delivery_zone_id = coalesce(excluded.delivery_zone_id, public.customer_addresses.delivery_zone_id);

  delete from public.customer_addresses
  where business_id = p_business_id
    and canonical_customer_id = p_merged_customer_id;

  insert into public.customer_segments(
    business_id, canonical_customer_id, segment_key, assigned_at, source
  )
  select
    business_id,
    p_survivor_customer_id,
    segment_key,
    assigned_at,
    source
  from public.customer_segments
  where business_id = p_business_id
    and canonical_customer_id = p_merged_customer_id
  on conflict (canonical_customer_id, segment_key) do nothing;

  delete from public.customer_segments
  where business_id = p_business_id
    and canonical_customer_id = p_merged_customer_id;

  update public.business_customers
  set display_name = coalesce(v_survivor.display_name, v_merged.display_name),
      updated_at = now()
  where id = p_survivor_customer_id
    and business_id = p_business_id;

  -- Keep canonical lineage flat. Immutable ledger/usage history remains attached to
  -- retired identities, so every retired descendant must point directly at the
  -- latest survivor for one-hop lookup and canonical aggregate queries.
  update public.business_customers
  set merged_into_customer_id = p_survivor_customer_id,
      updated_at = now()
  where business_id = p_business_id
    and merged_into_customer_id = p_merged_customer_id;

  update public.business_customers
  set merged_into_customer_id = p_survivor_customer_id,
      updated_at = now()
  where id = p_merged_customer_id
    and business_id = p_business_id;

  perform public.append_admin_audit_event_v1(
    p_business_id,
    null,
    p_employee_id,
    'CUSTOMER_MERGED',
    'CUSTOMER',
    p_survivor_customer_id::text,
    jsonb_build_object(
      'survivorCustomerId', p_survivor_customer_id,
      'mergedCustomerId', p_merged_customer_id
    ),
    jsonb_build_object(
      'survivorCustomerId', p_survivor_customer_id,
      'mergedCustomerId', p_merged_customer_id,
      'merged', true
    ),
    null,
    null,
    null,
    jsonb_build_object('commandId', p_command_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'survivorCustomerId', p_survivor_customer_id,
    'mergedCustomerId', p_merged_customer_id,
    'replayed', false
  );

  insert into public.admin_customer_merge_receipts(
    business_id,
    command_id,
    survivor_customer_id,
    merged_customer_id,
    result_json
  )
  values (
    p_business_id,
    p_command_id,
    p_survivor_customer_id,
    p_merged_customer_id,
    v_result
  );

  return v_result;
end;
$merge_customers$;

revoke all on function public.merge_admin_customers_v1(
  uuid, uuid, uuid, uuid, boolean, text
) from public, anon, authenticated;

grant execute on function public.merge_admin_customers_v1(
  uuid, uuid, uuid, uuid, boolean, text
) to service_role;
