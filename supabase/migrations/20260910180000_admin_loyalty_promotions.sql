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
      v_promotion_discount := 0;
    end if;
  end if;

  v_expires_at := p_now + interval '10 minutes';
  v_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'configurationVersion',
      greatest(coalesce(v_program.version, 0), coalesce(v_promotion.version, 0)),
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
        'redemptionValueMinor', p_loyalty_points * v_program.redemption_minor_per_point
      ) end
  ));

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

  select o.shop_id
    into v_order_shop_id
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found or v_order_shop_id <> v_reservation.shop_id then
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
