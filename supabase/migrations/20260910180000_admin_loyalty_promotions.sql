-- TUX Admin Plan 5: canonical loyalty, promotions, and scarce reward reservations.
-- Repository migration only. Do not apply to a remote project during implementation Plans 5-9.

create table public.loyalty_programs (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  enabled boolean not null default false,
  earn_points_per_100_minor bigint not null default 0 check (earn_points_per_100_minor >= 0),
  redemption_minor_per_point bigint not null default 0 check (redemption_minor_per_point >= 0),
  minimum_redemption_points bigint not null default 0 check (minimum_redemption_points >= 0),
  point_expiry_days integer check (point_expiry_days is null or point_expiry_days > 0),
  shop_ids uuid[] not null default '{}'::uuid[],
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create table public.promotion_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('PERCENT', 'FIXED', 'FREE_ITEM')),
  active boolean not null default true,
  percent_basis_points integer check (
    percent_basis_points is null or percent_basis_points between 1 and 10000
  ),
  fixed_discount_minor bigint check (fixed_discount_minor is null or fixed_discount_minor >= 0),
  free_product_id uuid,
  minimum_order_minor bigint not null default 0 check (minimum_order_minor >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  shop_ids uuid[] not null default '{}'::uuid[],
  channel text not null default 'BOTH' check (channel in ('POS', 'ONLINE', 'BOTH')),
  product_ids uuid[] not null default '{}'::uuid[],
  category_ids uuid[] not null default '{}'::uuid[],
  total_usage_limit bigint check (total_usage_limit is null or total_usage_limit > 0),
  per_customer_usage_limit bigint check (
    per_customer_usage_limit is null or per_customer_usage_limit > 0
  ),
  stacking_policy text not null default 'ONE_ORDER_LEVEL'
    check (stacking_policy in ('ONE_ORDER_LEVEL', 'ALLOW_CONFIGURED')),
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (
    (kind = 'PERCENT' and percent_basis_points is not null
      and fixed_discount_minor is null and free_product_id is null)
    or
    (kind = 'FIXED' and fixed_discount_minor is not null
      and percent_basis_points is null and free_product_id is null)
    or
    (kind = 'FREE_ITEM' and free_product_id is not null
      and percent_basis_points is null and fixed_discount_minor is null)
  ),
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create index promotion_rules_business_active_idx
  on public.promotion_rules(business_id, active, starts_at, ends_at);

create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid references public.shops(id) on delete restrict,
  customer_id uuid not null references public.business_customers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  entry_key text not null check (btrim(entry_key) <> ''),
  event_type text not null check (event_type in (
    'EARN',
    'REDEEM',
    'MANUAL_ADJUSTMENT',
    'EXPIRY',
    'CANCEL_COMPENSATION',
    'REFUND_COMPENSATION',
    'RETURN_COMPENSATION'
  )),
  points_delta bigint not null check (points_delta <> 0),
  monetary_value_minor bigint not null default 0 check (monetary_value_minor >= 0),
  earn_expires_at timestamptz,
  reason_note text,
  source_event_id text,
  created_by_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, entry_key),
  foreign key (business_id, customer_id)
    references public.business_customers(business_id, id) on delete restrict,
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create index loyalty_ledger_customer_created_idx
  on public.loyalty_ledger(business_id, customer_id, created_at, id);
create index loyalty_ledger_order_idx
  on public.loyalty_ledger(order_id) where order_id is not null;

create table public.promotion_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  promotion_id uuid not null references public.promotion_rules(id) on delete restrict,
  customer_id uuid references public.business_customers(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  entry_key text not null check (btrim(entry_key) <> ''),
  usage_delta integer not null check (usage_delta in (-1, 1)),
  event_type text not null check (event_type in (
    'APPLY',
    'CANCEL_COMPENSATION',
    'REFUND_COMPENSATION',
    'RETURN_COMPENSATION'
  )),
  applied_rule_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (business_id, entry_key)
);
create index promotion_usage_ledger_rule_idx
  on public.promotion_usage_ledger(promotion_id, created_at, id);
create index promotion_usage_ledger_customer_idx
  on public.promotion_usage_ledger(promotion_id, customer_id, created_at, id)
  where customer_id is not null;

create table public.reward_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  customer_id uuid references public.business_customers(id) on delete restrict,
  checkout_intent_id text not null check (btrim(checkout_intent_id) <> ''),
  request_fingerprint text not null check (btrim(request_fingerprint) <> ''),
  promotion_id uuid references public.promotion_rules(id) on delete restrict,
  loyalty_points_reserved bigint not null default 0 check (loyalty_points_reserved >= 0),
  promotion_use_reserved boolean not null default false,
  applied_reward_snapshot jsonb not null,
  status text not null check (status in ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  expires_at timestamptz not null,
  consumed_order_id uuid references public.orders(id) on delete restrict,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, shop_id, checkout_intent_id),
  check (
    (status = 'CONSUMED' and consumed_order_id is not null and consumed_at is not null)
    or status <> 'CONSUMED'
  )
);
create index reward_reservations_customer_active_idx
  on public.reward_reservations(business_id, customer_id, status, expires_at);
create index reward_reservations_promotion_active_idx
  on public.reward_reservations(promotion_id, status, expires_at)
  where promotion_id is not null;

alter table public.orders
  add column if not exists applied_reward_snapshot jsonb,
  add column if not exists reward_reservation_id uuid;

alter table public.orders
  drop constraint if exists orders_reward_reservation_fk;
alter table public.orders
  add constraint orders_reward_reservation_fk
  foreign key (reward_reservation_id)
  references public.reward_reservations(id) on delete restrict;

alter table public.loyalty_programs enable row level security;
alter table public.promotion_rules enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.promotion_usage_ledger enable row level security;
alter table public.reward_reservations enable row level security;

revoke all on public.loyalty_programs from public, anon, authenticated;
revoke all on public.promotion_rules from public, anon, authenticated;
revoke all on public.loyalty_ledger from public, anon, authenticated;
revoke all on public.promotion_usage_ledger from public, anon, authenticated;
revoke all on public.reward_reservations from public, anon, authenticated;

grant select, insert, update on public.loyalty_programs to service_role;
grant select, insert, update on public.promotion_rules to service_role;
grant select, insert on public.loyalty_ledger to service_role;
grant select, insert on public.promotion_usage_ledger to service_role;
grant select, insert, update on public.reward_reservations to service_role;

create or replace function private.reject_loyalty_history_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $reject_loyalty_history_mutation$
begin
  raise exception 'TUX_LOYALTY_HISTORY_IMMUTABLE';
end;
$reject_loyalty_history_mutation$;

revoke all on function private.reject_loyalty_history_mutation_v1()
  from public, anon, authenticated;

drop trigger if exists loyalty_ledger_immutable on public.loyalty_ledger;
create trigger loyalty_ledger_immutable
before update or delete on public.loyalty_ledger
for each row execute function private.reject_loyalty_history_mutation_v1();

drop trigger if exists promotion_usage_ledger_immutable on public.promotion_usage_ledger;
create trigger promotion_usage_ledger_immutable
before update or delete on public.promotion_usage_ledger
for each row execute function private.reject_loyalty_history_mutation_v1();

create or replace function public.reserve_order_rewards_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_customer_id uuid,
  p_checkout_intent_id text,
  p_promotion_id uuid,
  p_loyalty_points bigint,
  p_channel text,
  p_subtotal_minor bigint,
  p_product_ids uuid[],
  p_category_ids uuid[],
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $reserve_order_rewards$
declare
  v_existing public.reward_reservations%rowtype;
  v_program public.loyalty_programs%rowtype;
  v_promotion public.promotion_rules%rowtype;
  v_fingerprint text;
  v_balance bigint := 0;
  v_reserved_points bigint := 0;
  v_total_uses bigint := 0;
  v_customer_uses bigint := 0;
  v_total_reserved bigint := 0;
  v_customer_reserved bigint := 0;
  v_promotion_discount bigint := 0;
  v_loyalty_discount bigint := 0;
  v_free_item_price bigint := 0;
  v_snapshot jsonb;
  v_expires_at timestamptz;
begin
  if p_channel not in ('POS', 'ONLINE')
     or p_subtotal_minor < 0
     or p_loyalty_points < 0
     or btrim(coalesce(p_checkout_intent_id, '')) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
  end if;

  if not exists (
    select 1
    from public.business_shops bs
    where bs.business_id = p_business_id
      and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'reward_shop_mismatch');
  end if;

  if p_customer_id is not null then
    perform 1
    from public.business_customers c
    where c.id = p_customer_id
      and c.business_id = p_business_id
      and c.merged_into_customer_id is null
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'reward_customer_mismatch');
    end if;
  elsif p_loyalty_points > 0 then
    return jsonb_build_object('ok', false, 'code', 'loyalty_customer_required');
  end if;

  v_fingerprint := md5(
    jsonb_build_object(
      'businessId', p_business_id,
      'shopId', p_shop_id,
      'customerId', p_customer_id,
      'promotionId', p_promotion_id,
      'loyaltyPoints', p_loyalty_points,
      'channel', p_channel,
      'subtotalMinor', p_subtotal_minor,
      'productIds', coalesce(to_jsonb(p_product_ids), '[]'::jsonb),
      'categoryIds', coalesce(to_jsonb(p_category_ids), '[]'::jsonb)
    )::text
  );

  select r.*
    into v_existing
  from public.reward_reservations r
  where r.business_id = p_business_id
    and r.shop_id = p_shop_id
    and r.checkout_intent_id = p_checkout_intent_id
  for update;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'checkout_intent_conflict');
    end if;
    if v_existing.status = 'CONSUMED' then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'expiresAt', v_existing.expires_at,
        'snapshot', v_existing.applied_reward_snapshot
      );
    end if;
    if v_existing.status = 'RESERVED' and v_existing.expires_at > p_now then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'expiresAt', v_existing.expires_at,
        'snapshot', v_existing.applied_reward_snapshot
      );
    end if;
    if v_existing.status = 'RESERVED' and v_existing.expires_at <= p_now then
      update public.reward_reservations
      set status = 'EXPIRED', updated_at = p_now
      where id = v_existing.id;
    end if;
  end if;

  if p_loyalty_points > 0 then
    select lp.*
      into v_program
    from public.loyalty_programs lp
    where lp.business_id = p_business_id
    for update;

    if not found or not v_program.enabled then
      return jsonb_build_object('ok', false, 'code', 'loyalty_disabled');
    end if;
    if cardinality(v_program.shop_ids) > 0
       and not (p_shop_id = any(v_program.shop_ids)) then
      return jsonb_build_object('ok', false, 'code', 'loyalty_shop_mismatch');
    end if;
    if p_loyalty_points < v_program.minimum_redemption_points then
      return jsonb_build_object('ok', false, 'code', 'minimum_redemption_not_met');
    end if;

    select coalesce(sum(l.points_delta), 0)
      into v_balance
    from public.loyalty_ledger l
    where l.business_id = p_business_id
      and l.customer_id in (
        select c.id
        from public.business_customers c
        where c.business_id = p_business_id
          and (
            c.id = p_customer_id
            or c.merged_into_customer_id = p_customer_id
          )
      );

    select coalesce(sum(r.loyalty_points_reserved), 0)
      into v_reserved_points
    from public.reward_reservations r
    where r.business_id = p_business_id
      and r.customer_id = p_customer_id
      and r.status = 'RESERVED'
      and r.expires_at > p_now
      and (v_existing.id is null or r.id <> v_existing.id);

    if v_balance - v_reserved_points < p_loyalty_points then
      return jsonb_build_object('ok', false, 'code', 'loyalty_balance_changed');
    end if;
  end if;

  if p_promotion_id is not null then
    select pr.*
      into v_promotion
    from public.promotion_rules pr
    where pr.id = p_promotion_id
      and pr.business_id = p_business_id
    for update;

    if not found or not v_promotion.active then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if v_promotion.starts_at is not null and p_now < v_promotion.starts_at then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if v_promotion.ends_at is not null and p_now >= v_promotion.ends_at then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if cardinality(v_promotion.shop_ids) > 0
       and not (p_shop_id = any(v_promotion.shop_ids)) then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if v_promotion.channel <> 'BOTH' and v_promotion.channel <> p_channel then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if p_subtotal_minor < v_promotion.minimum_order_minor then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if cardinality(v_promotion.product_ids) > 0
       and not (v_promotion.product_ids && coalesce(p_product_ids, '{}'::uuid[])) then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if cardinality(v_promotion.category_ids) > 0
       and not (v_promotion.category_ids && coalesce(p_category_ids, '{}'::uuid[])) then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;

    select coalesce(sum(u.usage_delta), 0)
      into v_total_uses
    from public.promotion_usage_ledger u
    where u.promotion_id = p_promotion_id;

    select coalesce(sum(u.usage_delta), 0)
      into v_customer_uses
    from public.promotion_usage_ledger u
    where u.promotion_id = p_promotion_id
      and u.customer_id = p_customer_id;

    select count(*)
      into v_total_reserved
    from public.reward_reservations r
    where r.promotion_id = p_promotion_id
      and r.status = 'RESERVED'
      and r.expires_at > p_now
      and (v_existing.id is null or r.id <> v_existing.id);

    select count(*)
      into v_customer_reserved
    from public.reward_reservations r
    where r.promotion_id = p_promotion_id
      and r.customer_id = p_customer_id
      and r.status = 'RESERVED'
      and r.expires_at > p_now
      and (v_existing.id is null or r.id <> v_existing.id);

    if v_promotion.total_usage_limit is not null
       and v_total_uses + v_total_reserved >= v_promotion.total_usage_limit then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;
    if v_promotion.per_customer_usage_limit is not null
       and (
         p_customer_id is null
         or v_customer_uses + v_customer_reserved >= v_promotion.per_customer_usage_limit
       ) then
      return jsonb_build_object('ok', false, 'code', 'reward_not_available');
    end if;

    if v_promotion.kind = 'FIXED' then
      v_promotion_discount := least(p_subtotal_minor, v_promotion.fixed_discount_minor);
    elsif v_promotion.kind = 'PERCENT' then
      v_promotion_discount := least(
        p_subtotal_minor,
        floor((p_subtotal_minor::numeric * v_promotion.percent_basis_points) / 10000)::bigint
      );
    else
      if v_promotion.free_product_id is null
         or not (v_promotion.free_product_id = any(coalesce(p_product_ids, '{}'::uuid[]))) then
        return jsonb_build_object('ok', false, 'code', 'reward_not_available');
      end if;
      select p.price_minor
        into v_free_item_price
      from public.products p
      where p.id = v_promotion.free_product_id
        and p.shop_id = p_shop_id
        and p.active
        and not p.sold_out;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'reward_not_available');
      end if;
      v_promotion_discount := least(p_subtotal_minor, v_free_item_price);
    end if;
  end if;

  if p_loyalty_points > 0 then
    v_loyalty_discount := p_loyalty_points * v_program.redemption_minor_per_point;
  end if;
  if v_promotion_discount + v_loyalty_discount > p_subtotal_minor then
    return jsonb_build_object('ok', false, 'code', 'reward_exceeds_order_total');
  end if;

  v_expires_at := p_now + interval '10 minutes';
  v_snapshot := jsonb_build_object(
    'configurationVersion',
      greatest(coalesce(v_program.version, 0), coalesce(v_promotion.version, 0)),
    'rewardDiscountMinor', v_promotion_discount + v_loyalty_discount,
    'promotion',
      case when p_promotion_id is null then null else jsonb_build_object(
        'id', v_promotion.id,
        'name', v_promotion.name,
        'kind', v_promotion.kind,
        'version', v_promotion.version,
        'percentBasisPoints', v_promotion.percent_basis_points,
        'fixedDiscountMinor', v_promotion.fixed_discount_minor,
        'freeProductId', v_promotion.free_product_id,
        'minimumOrderMinor', v_promotion.minimum_order_minor,
        'channel', v_promotion.channel,
        'promotionDiscountMinor', v_promotion_discount
      ) end,
    'loyalty',
      case when p_loyalty_points = 0 then null else jsonb_build_object(
        'pointsRedeemed', p_loyalty_points,
        'redemptionMinorPerPoint', v_program.redemption_minor_per_point,
        'redemptionValueMinor', v_loyalty_discount
      ) end
  );

  if v_existing.id is null then
    insert into public.reward_reservations(
      business_id,
      shop_id,
      customer_id,
      checkout_intent_id,
      request_fingerprint,
      promotion_id,
      loyalty_points_reserved,
      promotion_use_reserved,
      applied_reward_snapshot,
      status,
      expires_at
    ) values (
      p_business_id,
      p_shop_id,
      p_customer_id,
      p_checkout_intent_id,
      v_fingerprint,
      p_promotion_id,
      p_loyalty_points,
      p_promotion_id is not null,
      v_snapshot,
      'RESERVED',
      v_expires_at
    )
    returning * into v_existing;
  else
    update public.reward_reservations
    set
      customer_id = p_customer_id,
      promotion_id = p_promotion_id,
      loyalty_points_reserved = p_loyalty_points,
      promotion_use_reserved = p_promotion_id is not null,
      applied_reward_snapshot = v_snapshot,
      status = 'RESERVED',
      expires_at = v_expires_at,
      consumed_order_id = null,
      consumed_at = null,
      released_at = null,
      updated_at = p_now
    where id = v_existing.id
    returning * into v_existing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'reservationId', v_existing.id,
    'status', v_existing.status,
    'expiresAt', v_existing.expires_at,
    'snapshot', v_existing.applied_reward_snapshot
  );
end;
$reserve_order_rewards$;

revoke all on function public.reserve_order_rewards_v1(
  uuid, uuid, uuid, text, uuid, bigint, text, bigint, uuid[], uuid[], timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_order_rewards_v1(
  uuid, uuid, uuid, text, uuid, bigint, text, bigint, uuid[], uuid[], timestamptz
) to service_role;

create or replace function public.reserve_operations_order_rewards_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_shop_id uuid,
  p_checkout_intent_id text,
  p_customer_phone text,
  p_promotion_id uuid,
  p_loyalty_points bigint,
  p_channel text,
  p_items jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $reserve_operations_order_rewards$
declare
  v_business_id uuid;
  v_customer_id uuid;
  v_normalized_phone text;
  v_item jsonb;
  v_modifier jsonb;
  v_combo_value text;
  v_product_id uuid;
  v_modifier_id uuid;
  v_combo_id uuid;
  v_quantity integer;
  v_modifier_quantity integer;
  v_product_price bigint;
  v_product_category_id uuid;
  v_modifier_price bigint;
  v_modifier_max_quantity integer;
  v_subtotal_minor bigint := 0;
  v_product_ids uuid[] := '{}'::uuid[];
  v_category_ids uuid[] := '{}'::uuid[];
begin
  if p_channel not in ('POS', 'ONLINE')
     or btrim(coalesce(p_checkout_intent_id, '')) = ''
     or p_loyalty_points < 0
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
  end if;

  if not exists (
    select 1
    from public.shop_memberships membership
    join public.devices device
      on device.shop_id = membership.shop_id
     and device.auth_user_id = membership.auth_user_id
    where membership.shop_id = p_shop_id
      and membership.auth_user_id = p_auth_user_id
      and membership.role = 'OPERATIONS_DEVICE'
      and membership.active
      and device.id = p_device_id
      and device.auth_user_id = p_auth_user_id
      and device.active
  ) then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;

  select bs.business_id
    into v_business_id
  from public.business_shops bs
  where bs.shop_id = p_shop_id
  order by bs.business_id
  limit 1;
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'reward_shop_mismatch');
  end if;

  if btrim(coalesce(p_customer_phone, '')) <> '' then
    v_normalized_phone := private.canonicalize_egypt_customer_phone_v1(p_customer_phone);
    if v_normalized_phone is null then
      return jsonb_build_object('ok', false, 'code', 'reward_customer_phone_invalid');
    end if;
    select coalesce(c.merged_into_customer_id, c.id)
      into v_customer_id
    from public.business_customers c
    where c.business_id = v_business_id
      and c.normalized_phone = v_normalized_phone
    order by c.created_at, c.id
    limit 1;
  end if;

  if p_loyalty_points > 0 and v_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'loyalty_customer_required');
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'quantity') <> 'number'
       or coalesce(v_item ->> 'productId', '') = '' then
      return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
    end if;

    v_product_id := (v_item ->> 'productId')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 or v_quantity > 1000 then
      return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
    end if;

    select p.price_minor, p.category_id
      into v_product_price, v_product_category_id
    from public.products p
    where p.id = v_product_id
      and p.shop_id = p_shop_id
      and p.active
      and not p.sold_out;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'reward_product_unavailable');
    end if;

    v_subtotal_minor := v_subtotal_minor + (v_product_price * v_quantity);
    if not (v_product_id = any(v_product_ids)) then
      v_product_ids := array_append(v_product_ids, v_product_id);
    end if;
    if not (v_product_category_id = any(v_category_ids)) then
      v_category_ids := array_append(v_category_ids, v_product_category_id);
    end if;

    if coalesce(jsonb_typeof(v_item -> 'modifiers'), 'array') <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
    end if;
    for v_modifier in
      select value
      from jsonb_array_elements(coalesce(v_item -> 'modifiers', '[]'::jsonb))
    loop
      if jsonb_typeof(v_modifier) <> 'object'
         or jsonb_typeof(v_modifier -> 'quantity') <> 'number'
         or coalesce(v_modifier ->> 'modifierId', '') = '' then
        return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
      end if;
      v_modifier_id := (v_modifier ->> 'modifierId')::uuid;
      v_modifier_quantity := (v_modifier ->> 'quantity')::integer;
      if v_modifier_quantity < 1 or v_modifier_quantity > 1000 then
        return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
      end if;

      select m.price_minor, pm.max_quantity
        into v_modifier_price, v_modifier_max_quantity
      from public.modifiers m
      join public.product_modifiers pm
        on pm.modifier_id = m.id
       and pm.product_id = v_product_id
       and pm.shop_id = p_shop_id
      where m.id = v_modifier_id
        and m.shop_id = p_shop_id
        and m.active;
      if not found
         or (v_modifier_max_quantity is not null and v_modifier_quantity > v_modifier_max_quantity) then
        return jsonb_build_object('ok', false, 'code', 'reward_modifier_unavailable');
      end if;
      v_subtotal_minor :=
        v_subtotal_minor + (v_modifier_price * v_modifier_quantity * v_quantity);
    end loop;

    if coalesce(jsonb_typeof(v_item -> 'comboBeverageProductIds'), 'array') <> 'array' then
      return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
    end if;
    for v_combo_value in
      select value
      from jsonb_array_elements_text(
        coalesce(v_item -> 'comboBeverageProductIds', '[]'::jsonb)
      )
    loop
      v_combo_id := v_combo_value::uuid;
      if not exists (
        select 1
        from public.combo_beverage_options option
        join public.products beverage
          on beverage.id = option.beverage_product_id
         and beverage.shop_id = p_shop_id
         and beverage.active
         and not beverage.sold_out
        where option.shop_id = p_shop_id
          and option.combo_product_id = v_product_id
          and option.beverage_product_id = v_combo_id
      ) then
        return jsonb_build_object('ok', false, 'code', 'reward_combo_unavailable');
      end if;
    end loop;
  end loop;

  return public.reserve_order_rewards_v1(
    v_business_id,
    p_shop_id,
    v_customer_id,
    p_checkout_intent_id,
    p_promotion_id,
    p_loyalty_points,
    p_channel,
    v_subtotal_minor,
    v_product_ids,
    v_category_ids,
    p_now
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    return jsonb_build_object('ok', false, 'code', 'invalid_reward_request');
end;
$reserve_operations_order_rewards$;

revoke all on function public.reserve_operations_order_rewards_v1(
  uuid, uuid, uuid, text, text, uuid, bigint, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_operations_order_rewards_v1(
  uuid, uuid, uuid, text, text, uuid, bigint, text, jsonb, timestamptz
) to service_role;

create or replace function public.release_operations_order_reward_reservation_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_shop_id uuid,
  p_reservation_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $release_operations_order_reward$
begin
  if not exists (
    select 1
    from public.shop_memberships membership
    join public.devices device
      on device.shop_id = membership.shop_id
     and device.auth_user_id = membership.auth_user_id
    where membership.shop_id = p_shop_id
      and membership.auth_user_id = p_auth_user_id
      and membership.role = 'OPERATIONS_DEVICE'
      and membership.active
      and device.id = p_device_id
      and device.auth_user_id = p_auth_user_id
      and device.active
  ) then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.reward_reservations r
    where r.id = p_reservation_id
      and r.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_mismatch');
  end if;

  return public.release_order_reward_reservation_v1(p_reservation_id, p_now);
end;
$release_operations_order_reward$;

revoke all on function public.release_operations_order_reward_reservation_v1(
  uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.release_operations_order_reward_reservation_v1(
  uuid, uuid, uuid, uuid, timestamptz
) to service_role;

create or replace function public.consume_order_reward_reservation_v1(
  p_reservation_id uuid,
  p_order_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $consume_order_reward_reservation$
declare
  v_reservation public.reward_reservations%rowtype;
  v_order_shop_id uuid;
  v_order_total_minor bigint;
  v_order_idempotency_key text;
  v_order_reward_reservation_id uuid;
  v_order_reward_snapshot jsonb;
  v_order_discount_minor bigint;
  v_program public.loyalty_programs%rowtype;
  v_earn_points bigint := 0;
begin
  select r.*
    into v_reservation
  from public.reward_reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_not_found');
  end if;
  if v_reservation.status = 'CONSUMED' then
    if v_reservation.consumed_order_id = p_order_id then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'reservationId', v_reservation.id,
        'snapshot', v_reservation.applied_reward_snapshot
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_consumed');
  end if;
  if v_reservation.status <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_unavailable');
  end if;
  if v_reservation.expires_at <= p_now then
    update public.reward_reservations
    set status = 'EXPIRED', updated_at = p_now
    where id = v_reservation.id;
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_expired');
  end if;

  select
    o.shop_id,
    o.total_minor,
    o.idempotency_key,
    o.reward_reservation_id,
    o.applied_reward_snapshot,
    o.discount_minor
    into
      v_order_shop_id,
      v_order_total_minor,
      v_order_idempotency_key,
      v_order_reward_reservation_id,
      v_order_reward_snapshot,
      v_order_discount_minor
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found
     or v_order_shop_id <> v_reservation.shop_id
     or v_order_idempotency_key <> v_reservation.checkout_intent_id
     or (
       v_order_reward_reservation_id is not null
       and v_order_reward_reservation_id <> v_reservation.id
     )
     or (
       v_order_reward_snapshot is not null
       and v_order_reward_snapshot <> v_reservation.applied_reward_snapshot
     )
     or coalesce(
       (v_reservation.applied_reward_snapshot ->> 'rewardDiscountMinor')::bigint,
       0
     ) > v_order_discount_minor then
    return jsonb_build_object('ok', false, 'code', 'reward_order_mismatch');
  end if;

  if v_reservation.loyalty_points_reserved > 0 then
    insert into public.loyalty_ledger(
      business_id,
      shop_id,
      customer_id,
      order_id,
      entry_key,
      event_type,
      points_delta,
      monetary_value_minor,
      source_event_id
    ) values (
      v_reservation.business_id,
      v_reservation.shop_id,
      v_reservation.customer_id,
      p_order_id,
      'reward-reservation:' || v_reservation.id::text || ':redeem',
      'REDEEM',
      -v_reservation.loyalty_points_reserved,
      coalesce(
        (v_reservation.applied_reward_snapshot #>> '{loyalty,redemptionValueMinor}')::bigint,
        0
      ),
      v_reservation.id::text
    )
    on conflict (business_id, entry_key) do nothing;
  end if;

  if v_reservation.promotion_id is not null and v_reservation.promotion_use_reserved then
    insert into public.promotion_usage_ledger(
      business_id,
      shop_id,
      promotion_id,
      customer_id,
      order_id,
      entry_key,
      usage_delta,
      event_type,
      applied_rule_snapshot
    ) values (
      v_reservation.business_id,
      v_reservation.shop_id,
      v_reservation.promotion_id,
      v_reservation.customer_id,
      p_order_id,
      'reward-reservation:' || v_reservation.id::text || ':promotion-apply',
      1,
      'APPLY',
      v_reservation.applied_reward_snapshot -> 'promotion'
    )
    on conflict (business_id, entry_key) do nothing;
  end if;

  if v_reservation.customer_id is not null then
    select p.*
      into v_program
    from public.loyalty_programs p
    where p.business_id = v_reservation.business_id
    for share;

    if found
       and v_program.enabled
       and (
         coalesce(array_length(v_program.shop_ids, 1), 0) = 0
         or v_reservation.shop_id = any(v_program.shop_ids)
       ) then
      v_earn_points :=
        (v_order_total_minor / 100) * v_program.earn_points_per_100_minor;
      if v_earn_points > 0 then
        insert into public.loyalty_ledger(
          business_id,
          shop_id,
          customer_id,
          order_id,
          entry_key,
          event_type,
          points_delta,
          monetary_value_minor,
          earn_expires_at,
          source_event_id
        ) values (
          v_reservation.business_id,
          v_reservation.shop_id,
          v_reservation.customer_id,
          p_order_id,
          'reward-reservation:' || v_reservation.id::text || ':earn',
          'EARN',
          v_earn_points,
          0,
          case
            when v_program.point_expiry_days is null then null
            else p_now + make_interval(days => v_program.point_expiry_days)
          end,
          v_reservation.id::text
        )
        on conflict (business_id, entry_key) do nothing;
      end if;
    end if;
  end if;

  update public.orders
  set
    reward_reservation_id = v_reservation.id,
    applied_reward_snapshot = v_reservation.applied_reward_snapshot
  where id = p_order_id
    and shop_id = v_reservation.shop_id
    and (
      reward_reservation_id is null
      or reward_reservation_id = v_reservation.id
    )
    and (
      applied_reward_snapshot is null
      or applied_reward_snapshot = v_reservation.applied_reward_snapshot
    );

  if not found then
    raise exception 'TUX_REWARD_ORDER_SNAPSHOT_CONFLICT';
  end if;

  update public.reward_reservations
  set
    status = 'CONSUMED',
    consumed_order_id = p_order_id,
    consumed_at = p_now,
    updated_at = p_now
  where id = v_reservation.id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'reservationId', v_reservation.id,
    'snapshot', v_reservation.applied_reward_snapshot
  );
end;
$consume_order_reward_reservation$;

revoke all on function public.consume_order_reward_reservation_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_order_reward_reservation_v1(uuid, uuid, timestamptz)
  to service_role;

create or replace function private.consume_inserted_order_reward_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $consume_inserted_order_reward$
declare
  v_result jsonb;
begin
  if new.reward_reservation_id is null then
    return new;
  end if;

  v_result := public.consume_order_reward_reservation_v1(
    new.reward_reservation_id,
    new.id,
    coalesce(new.updated_at, new.created_at, now())
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'TUX_REWARD_RESERVATION_FINALIZATION_FAILED:%',
      coalesce(v_result ->> 'code', 'unknown');
  end if;

  return new;
end;
$consume_inserted_order_reward$;

revoke all on function private.consume_inserted_order_reward_v1()
  from public, anon, authenticated;

drop trigger if exists orders_consume_reward_reservation
  on public.orders;
create trigger orders_consume_reward_reservation
after insert on public.orders
for each row
when (new.reward_reservation_id is not null)
execute function private.consume_inserted_order_reward_v1();

create or replace function public.release_order_reward_reservation_v1(
  p_reservation_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $release_order_reward_reservation$
declare
  v_reservation public.reward_reservations%rowtype;
begin
  select r.*
    into v_reservation
  from public.reward_reservations r
  where r.id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_not_found');
  end if;
  if v_reservation.status = 'CONSUMED' then
    return jsonb_build_object('ok', false, 'code', 'reward_reservation_consumed');
  end if;
  if v_reservation.status in ('RELEASED', 'EXPIRED') then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'reservationId', v_reservation.id,
      'status', v_reservation.status
    );
  end if;

  update public.reward_reservations
  set
    status = case when expires_at <= p_now then 'EXPIRED' else 'RELEASED' end,
    released_at = case when expires_at > p_now then p_now else released_at end,
    updated_at = p_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'reservationId', v_reservation.id,
    'status', v_reservation.status
  );
end;
$release_order_reward_reservation$;

revoke all on function public.release_order_reward_reservation_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_order_reward_reservation_v1(uuid, timestamptz)
  to service_role;

create or replace function public.expire_order_reward_reservations_v1(
  p_now timestamptz,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $expire_order_reward_reservations$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'TUX_REWARD_EXPIRY_LIMIT_INVALID';
  end if;

  with claimed as (
    select r.id
    from public.reward_reservations r
    where r.status = 'RESERVED'
      and r.expires_at <= p_now
    order by r.expires_at, r.id
    for update skip locked
    limit p_limit
  ),
  expired as (
    update public.reward_reservations r
    set status = 'EXPIRED', updated_at = p_now
    from claimed c
    where r.id = c.id
    returning r.id
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$expire_order_reward_reservations$;

revoke all on function public.expire_order_reward_reservations_v1(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.expire_order_reward_reservations_v1(timestamptz, integer)
  to service_role;


-- Trusted Admin CRM mutations and immutable reason snapshots.
alter table public.loyalty_ledger
  add column if not exists reason_code_id uuid references public.admin_reason_codes(id) on delete restrict,
  add column if not exists reason_code_key text,
  add column if not exists reason_label_snapshot text,
  add column if not exists reason_family_snapshot text,
  add column if not exists reason_config_version bigint;

alter table public.loyalty_ledger
  drop constraint if exists loyalty_ledger_reason_snapshot_ck;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_reason_snapshot_ck check (
    (
      reason_code_id is null
      and reason_code_key is null
      and reason_label_snapshot is null
      and reason_family_snapshot is null
      and reason_config_version is null
    )
    or
    (
      reason_code_id is not null
      and reason_code_key is not null
      and reason_label_snapshot is not null
      and reason_family_snapshot is not null
      and reason_config_version is not null
    )
  );

create table if not exists public.admin_loyalty_command_receipts (
  business_id uuid not null references public.businesses(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  command_type text not null check (btrim(command_type) <> ''),
  request_fingerprint text not null check (btrim(request_fingerprint) <> ''),
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz not null default now(),
  primary key (business_id, command_id)
);

alter table public.admin_loyalty_command_receipts enable row level security;
revoke all on public.admin_loyalty_command_receipts from public, anon, authenticated;
grant select, insert on public.admin_loyalty_command_receipts to service_role;

create or replace function private.admin_loyalty_authority_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $admin_loyalty_authority$
declare
  v_auth record;
begin
  select * into v_auth
  from public.resolve_admin_authorization_v1(
    p_employee_id,
    p_shop_id,
    p_permission
  );

  if not coalesce(v_auth.authorized, false) or v_auth.business_id is null then
    raise exception 'TUX_ADMIN_LOYALTY_FORBIDDEN:%', coalesce(v_auth.denial_code, 'unknown');
  end if;
  if not exists (
    select 1
    from public.business_shops bs
    where bs.business_id = v_auth.business_id
      and bs.shop_id = p_shop_id
  ) then
    raise exception 'TUX_ADMIN_LOYALTY_SHOP_FORBIDDEN';
  end if;
  return v_auth.business_id;
end;
$admin_loyalty_authority$;

revoke all on function private.admin_loyalty_authority_v1(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function private.admin_loyalty_reason_snapshot_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_reason_code_id uuid
)
returns table(
  reason_code_key text,
  reason_label text,
  reason_family text,
  reason_version bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $admin_loyalty_reason$
begin
  return query
  select r.reason_key, r.label, r.family, r.version
  from public.admin_reason_codes r
  where r.id = p_reason_code_id
    and r.business_id = p_business_id
    and r.family = 'DISCOUNT_COMP'
    and r.active
    and (r.shop_id is null or r.shop_id = p_shop_id)
  limit 1;

  if not found then
    raise exception 'TUX_ADMIN_LOYALTY_REASON_INVALID';
  end if;
end;
$admin_loyalty_reason$;

revoke all on function private.admin_loyalty_reason_snapshot_v1(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.upsert_admin_loyalty_program_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_enabled boolean,
  p_earn_points_per_100_minor bigint,
  p_redemption_minor_per_point bigint,
  p_minimum_redemption_points bigint,
  p_point_expiry_days integer,
  p_shop_ids uuid[],
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $upsert_admin_loyalty$
declare
  v_business_id uuid;
  v_existing public.loyalty_programs%rowtype;
  v_next_version bigint;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_enabled is null
     or p_earn_points_per_100_minor is null
     or p_earn_points_per_100_minor < 0
     or p_redemption_minor_per_point is null
     or p_redemption_minor_per_point <= 0
     or p_minimum_redemption_points is null
     or p_minimum_redemption_points <= 0
     or (p_point_expiry_days is not null and p_point_expiry_days <= 0)
     or p_shop_ids is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_loyalty_program');
  end if;

  v_business_id := private.admin_loyalty_authority_v1(
    p_employee_id, p_shop_id, 'loyalty.manage'
  );

  if exists (
    select 1
    from unnest(p_shop_ids) requested(shop_id)
    where not exists (
      select 1 from public.business_shops bs
      where bs.business_id = v_business_id
        and bs.shop_id = requested.shop_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'loyalty_shop_scope_invalid');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-loyalty-program:' || v_business_id::text, 0)
  );

  select p.* into v_existing
  from public.loyalty_programs p
  where p.business_id = v_business_id
  for update;

  if found then
    if p_expected_version is null or v_existing.version <> p_expected_version then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_loyalty_program_version',
        'currentVersion', v_existing.version
      );
    end if;
    v_next_version := v_existing.version + 1;
    update public.loyalty_programs
    set enabled = p_enabled,
        earn_points_per_100_minor = p_earn_points_per_100_minor,
        redemption_minor_per_point = p_redemption_minor_per_point,
        minimum_redemption_points = p_minimum_redemption_points,
        point_expiry_days = p_point_expiry_days,
        shop_ids = p_shop_ids,
        version = v_next_version,
        updated_by_employee_id = p_employee_id,
        updated_at = now()
    where business_id = v_business_id;
  else
    if p_expected_version is not null then
      return jsonb_build_object('ok', false, 'code', 'loyalty_program_not_found');
    end if;
    v_next_version := 1;
    insert into public.loyalty_programs(
      business_id, enabled, earn_points_per_100_minor,
      redemption_minor_per_point, minimum_redemption_points,
      point_expiry_days, shop_ids, version, updated_by_employee_id
    ) values (
      v_business_id, p_enabled, p_earn_points_per_100_minor,
      p_redemption_minor_per_point, p_minimum_redemption_points,
      p_point_expiry_days, p_shop_ids, v_next_version, p_employee_id
    );
  end if;

  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_employee_id,
    'LOYALTY_PROGRAM_UPDATED',
    'LOYALTY_PROGRAM',
    v_business_id::text,
    case when v_existing.business_id is null then null else jsonb_build_object(
      'version', v_existing.version,
      'enabled', v_existing.enabled
    ) end,
    jsonb_build_object(
      'version', v_next_version,
      'enabled', p_enabled,
      'earnPointsPer100Minor', p_earn_points_per_100_minor,
      'redemptionMinorPerPoint', p_redemption_minor_per_point,
      'minimumRedemptionPoints', p_minimum_redemption_points,
      'pointExpiryDays', p_point_expiry_days,
      'shopIds', to_jsonb(p_shop_ids)
    ),
    null,
    null,
    null,
    jsonb_build_object('source', 'admin_bff')
  );

  return jsonb_build_object('ok', true, 'version', v_next_version);
end;
$upsert_admin_loyalty$;

revoke all on function public.upsert_admin_loyalty_program_v1(
  uuid, uuid, boolean, bigint, bigint, bigint, integer, uuid[], bigint
) from public, anon, authenticated;
grant execute on function public.upsert_admin_loyalty_program_v1(
  uuid, uuid, boolean, bigint, bigint, bigint, integer, uuid[], bigint
) to service_role;

create or replace function public.adjust_admin_customer_loyalty_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_customer_id uuid,
  p_points_delta bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $adjust_admin_loyalty$
declare
  v_business_id uuid;
  v_reason record;
  v_existing public.admin_loyalty_command_receipts%rowtype;
  v_fingerprint text;
  v_balance bigint;
  v_event_id uuid;
  v_result jsonb;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_customer_id is null
     or p_points_delta is null
     or p_points_delta = 0
     or p_reason_code_id is null
     or nullif(btrim(p_command_id), '') is null
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_loyalty_adjustment');
  end if;

  v_business_id := private.admin_loyalty_authority_v1(
    p_employee_id, p_shop_id, 'loyalty.manage'
  );
  if v_business_id is distinct from p_business_id then
    return jsonb_build_object('ok', false, 'code', 'loyalty_business_mismatch');
  end if;

  perform 1
  from public.business_customers c
  where c.id = p_customer_id
    and c.business_id = v_business_id
    and c.merged_into_customer_id is null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'customer_not_found');
  end if;

  select * into v_reason
  from private.admin_loyalty_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id
  );

  v_fingerprint := md5(
    jsonb_build_object(
      'shopId', p_shop_id,
      'customerId', p_customer_id,
      'pointsDelta', p_points_delta,
      'reasonCodeId', p_reason_code_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )::text
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-loyalty-command:' || v_business_id::text || ':' || p_command_id,
      0
    )
  );

  select * into v_existing
  from public.admin_loyalty_command_receipts r
  where r.business_id = v_business_id
    and r.command_id = p_command_id
  for update;

  if found then
    if v_existing.command_type = 'MANUAL_ADJUSTMENT'
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select coalesce(sum(l.points_delta), 0)
    into v_balance
  from public.loyalty_ledger l
  where l.business_id = v_business_id
    and l.customer_id in (
      select c.id
      from public.business_customers c
      where c.business_id = v_business_id
        and (c.id = p_customer_id or c.merged_into_customer_id = p_customer_id)
    );

  if v_balance + p_points_delta < 0 then
    return jsonb_build_object('ok', false, 'code', 'loyalty_balance_insufficient');
  end if;

  v_event_id := gen_random_uuid();
  insert into public.loyalty_ledger(
    id, business_id, shop_id, customer_id, entry_key, event_type,
    points_delta, monetary_value_minor, reason_note, source_event_id,
    created_by_employee_id, reason_code_id, reason_code_key,
    reason_label_snapshot, reason_family_snapshot, reason_config_version
  ) values (
    v_event_id, v_business_id, p_shop_id, p_customer_id,
    'admin-loyalty-adjust:' || p_command_id, 'MANUAL_ADJUSTMENT',
    p_points_delta, 0, nullif(btrim(coalesce(p_note, '')), ''), p_command_id,
    p_employee_id, p_reason_code_id, v_reason.reason_code_key,
    v_reason.reason_label, v_reason.reason_family, v_reason.reason_version
  );

  v_balance := v_balance + p_points_delta;
  v_result := jsonb_build_object(
    'ok', true,
    'ledgerEventId', v_event_id,
    'balance', v_balance,
    'replayed', false
  );

  insert into public.admin_loyalty_command_receipts(
    business_id, command_id, command_type, request_fingerprint, result_json
  ) values (
    v_business_id, p_command_id, 'MANUAL_ADJUSTMENT', v_fingerprint, v_result
  );

  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_employee_id,
    'LOYALTY_MANUAL_ADJUSTMENT',
    'CUSTOMER',
    p_customer_id::text,
    jsonb_build_object('balance', v_balance - p_points_delta),
    jsonb_build_object(
      'balance', v_balance,
      'pointsDelta', p_points_delta,
      'reasonCodeId', p_reason_code_id,
      'reasonCodeKey', v_reason.reason_code_key,
      'reasonLabel', v_reason.reason_label,
      'reasonFamily', v_reason.reason_family,
      'reasonConfigVersion', v_reason.reason_version
    ),
    nullif(btrim(coalesce(p_note, '')), ''),
    null,
    null,
    jsonb_build_object('commandId', p_command_id)
  );

  return v_result;
end;
$adjust_admin_loyalty$;

revoke all on function public.adjust_admin_customer_loyalty_v1(
  uuid, uuid, uuid, bigint, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.adjust_admin_customer_loyalty_v1(
  uuid, uuid, uuid, bigint, uuid, text, text, uuid
) to service_role;

create or replace function public.upsert_admin_promotion_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_promotion_id uuid,
  p_name text,
  p_active boolean,
  p_kind text,
  p_percent_basis_points integer,
  p_fixed_discount_minor bigint,
  p_free_product_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_minimum_order_minor bigint,
  p_shop_ids uuid[],
  p_channel text,
  p_product_ids uuid[],
  p_category_ids uuid[],
  p_total_usage_limit bigint,
  p_per_customer_usage_limit bigint,
  p_stacking_policy text,
  p_expected_version bigint,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $upsert_admin_promotion$
declare
  v_business_id uuid;
  v_existing public.promotion_rules%rowtype;
  v_receipt public.admin_loyalty_command_receipts%rowtype;
  v_fingerprint text;
  v_id uuid;
  v_version bigint;
  v_result jsonb;
begin
  if p_employee_id is null
     or p_shop_id is null
     or nullif(btrim(p_name), '') is null
     or p_active is null
     or p_kind not in ('PERCENT', 'FIXED', 'FREE_ITEM')
     or p_minimum_order_minor is null
     or p_minimum_order_minor < 0
     or p_shop_ids is null
     or p_channel not in ('POS', 'ONLINE', 'BOTH')
     or p_product_ids is null
     or p_category_ids is null
     or (p_total_usage_limit is not null and p_total_usage_limit <= 0)
     or (p_per_customer_usage_limit is not null and p_per_customer_usage_limit <= 0)
     or p_stacking_policy not in ('ONE_ORDER_LEVEL', 'ALLOW_CONFIGURED')
     or (p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at)
     or nullif(btrim(p_command_id), '') is null
     or (
       p_kind = 'PERCENT'
       and (
         p_percent_basis_points is null
         or p_percent_basis_points <= 0
         or p_percent_basis_points > 10000
         or p_fixed_discount_minor is not null
         or p_free_product_id is not null
       )
     )
     or (
       p_kind = 'FIXED'
       and (
         p_fixed_discount_minor is null
         or p_fixed_discount_minor < 0
         or p_percent_basis_points is not null
         or p_free_product_id is not null
       )
     )
     or (
       p_kind = 'FREE_ITEM'
       and (
         p_free_product_id is null
         or p_percent_basis_points is not null
         or p_fixed_discount_minor is not null
       )
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_promotion');
  end if;

  v_business_id := private.admin_loyalty_authority_v1(
    p_employee_id, p_shop_id, 'promotions.manage'
  );

  if exists (
    select 1 from unnest(p_shop_ids) requested(shop_id)
    where not exists (
      select 1 from public.business_shops bs
      where bs.business_id = v_business_id
        and bs.shop_id = requested.shop_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'promotion_shop_scope_invalid');
  end if;

  if p_free_product_id is not null and not exists (
    select 1
    from public.products product
    join public.business_shops bs on bs.shop_id = product.shop_id
    where product.id = p_free_product_id
      and bs.business_id = v_business_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'promotion_free_product_invalid');
  end if;

  if exists (
    select 1
    from unnest(p_product_ids) requested(product_id)
    where not exists (
      select 1
      from public.products product
      join public.business_shops bs on bs.shop_id = product.shop_id
      where product.id = requested.product_id
        and bs.business_id = v_business_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'promotion_product_scope_invalid');
  end if;

  if exists (
    select 1
    from unnest(p_category_ids) requested(category_id)
    where not exists (
      select 1
      from public.menu_categories category
      join public.business_shops bs on bs.shop_id = category.shop_id
      where category.id = requested.category_id
        and bs.business_id = v_business_id
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'promotion_category_scope_invalid');
  end if;

  v_fingerprint := md5(
    jsonb_build_object(
      'promotionId', p_promotion_id,
      'name', btrim(p_name),
      'active', p_active,
      'kind', p_kind,
      'percentBasisPoints', p_percent_basis_points,
      'fixedDiscountMinor', p_fixed_discount_minor,
      'freeProductId', p_free_product_id,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at,
      'minimumOrderMinor', p_minimum_order_minor,
      'shopIds', to_jsonb(p_shop_ids),
      'channel', p_channel,
      'productIds', to_jsonb(p_product_ids),
      'categoryIds', to_jsonb(p_category_ids),
      'totalUsageLimit', p_total_usage_limit,
      'perCustomerUsageLimit', p_per_customer_usage_limit,
      'stackingPolicy', p_stacking_policy,
      'expectedVersion', p_expected_version
    )::text
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-promotion-command:' || v_business_id::text || ':' || p_command_id,
      0
    )
  );

  select * into v_receipt
  from public.admin_loyalty_command_receipts r
  where r.business_id = v_business_id
    and r.command_id = p_command_id
  for update;
  if found then
    if v_receipt.command_type = 'PROMOTION_UPSERT'
       and v_receipt.request_fingerprint = v_fingerprint then
      return v_receipt.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  if p_promotion_id is null then
    if p_expected_version is not null then
      return jsonb_build_object('ok', false, 'code', 'promotion_not_found');
    end if;
    v_id := gen_random_uuid();
    v_version := 1;
    insert into public.promotion_rules(
      id, business_id, name, active, kind, percent_basis_points,
      fixed_discount_minor, free_product_id, starts_at, ends_at,
      minimum_order_minor, shop_ids, channel, product_ids, category_ids,
      total_usage_limit, per_customer_usage_limit, stacking_policy,
      version, updated_by_employee_id
    ) values (
      v_id, v_business_id, btrim(p_name), p_active, p_kind, p_percent_basis_points,
      p_fixed_discount_minor, p_free_product_id, p_starts_at, p_ends_at,
      p_minimum_order_minor, p_shop_ids, p_channel, p_product_ids, p_category_ids,
      p_total_usage_limit, p_per_customer_usage_limit, p_stacking_policy,
      v_version, p_employee_id
    );
  else
    select p.* into v_existing
    from public.promotion_rules p
    where p.id = p_promotion_id
      and p.business_id = v_business_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'promotion_not_found');
    end if;
    if p_expected_version is null or v_existing.version <> p_expected_version then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_promotion_version',
        'currentVersion', v_existing.version
      );
    end if;
    v_id := v_existing.id;
    v_version := v_existing.version + 1;
    update public.promotion_rules
    set name = btrim(p_name),
        active = p_active,
        kind = p_kind,
        percent_basis_points = p_percent_basis_points,
        fixed_discount_minor = p_fixed_discount_minor,
        free_product_id = p_free_product_id,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        minimum_order_minor = p_minimum_order_minor,
        shop_ids = p_shop_ids,
        channel = p_channel,
        product_ids = p_product_ids,
        category_ids = p_category_ids,
        total_usage_limit = p_total_usage_limit,
        per_customer_usage_limit = p_per_customer_usage_limit,
        stacking_policy = p_stacking_policy,
        version = v_version,
        updated_by_employee_id = p_employee_id,
        updated_at = now()
    where id = v_id;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'promotionId', v_id,
    'version', v_version,
    'replayed', false
  );

  insert into public.admin_loyalty_command_receipts(
    business_id, command_id, command_type, request_fingerprint, result_json
  ) values (
    v_business_id, p_command_id, 'PROMOTION_UPSERT', v_fingerprint, v_result
  );

  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_employee_id,
    'PROMOTION_UPDATED',
    'PROMOTION',
    v_id::text,
    case when v_existing.id is null then null else jsonb_build_object(
      'version', v_existing.version,
      'active', v_existing.active
    ) end,
    jsonb_build_object(
      'version', v_version,
      'active', p_active,
      'kind', p_kind,
      'shopIds', to_jsonb(p_shop_ids),
      'channel', p_channel,
      'stackingPolicy', p_stacking_policy
    ),
    null,
    null,
    null,
    jsonb_build_object('commandId', p_command_id)
  );

  return v_result;
end;
$upsert_admin_promotion$;

revoke all on function public.upsert_admin_promotion_v1(
  uuid, uuid, uuid, text, boolean, text, integer, bigint, uuid,
  timestamptz, timestamptz, bigint, uuid[], text, uuid[], uuid[],
  bigint, bigint, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.upsert_admin_promotion_v1(
  uuid, uuid, uuid, text, boolean, text, integer, bigint, uuid,
  timestamptz, timestamptz, bigint, uuid[], text, uuid[], uuid[],
  bigint, bigint, text, bigint, text
) to service_role;
