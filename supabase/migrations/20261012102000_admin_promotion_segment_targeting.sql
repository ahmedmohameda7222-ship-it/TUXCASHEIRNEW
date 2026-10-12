-- Plan 5 correction: automatic segments are authoritative for promotion targeting.
-- Expand-only: unrestricted existing rows default to '{}', existing v1 upsert remains
-- backward-compatible and does not clear targets set by the new versioned v2 API.
-- Recovery: disable affected promotion(s) with the existing version-fenced upsert,
-- retaining targeting policy, until a forward-only corrective migration is verified.
alter table public.promotion_rules
  add column if not exists segment_targets text[] not null default '{}'::text[];
alter table public.promotion_rules
  add constraint promotion_rules_segment_targets_valid_ck
  check (
    cardinality(segment_targets) <= 8
    and array_position(segment_targets, null) is null
    and segment_targets <@ array[
      'New', 'Returning', 'VIP', 'Inactive 30 Days',
      'Inactive 60 Days', 'Top Spenders', 'Frequent Delivery', 'Loyalty Members'
    ]::text[]
  );


-- Canonical segmentation policy used by both POS and ONLINE via reservation RPC.
-- Match existing Plan 5 automatic taxonomy; do not accept client segment claims.
create or replace function private.customer_matches_promotion_segments_v1(
  p_business_id uuid,
  p_customer_id uuid,
  p_segments text[]
) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $segment_membership$
declare
  v_orders bigint := 0;
  v_spend_minor bigint := 0;
  v_last_order timestamptz;
  v_delivery_orders bigint := 0;
  v_loyalty_balance bigint := 0;
  v_now timestamptz := transaction_timestamp();
begin
  if p_business_id is null or p_customer_id is null or
     p_segments is null or cardinality(p_segments) = 0 then
    return false;
  end if;
  if not exists (
    select 1 from public.business_customers
    where id = p_customer_id
      and business_id = p_business_id
      and merged_into_customer_id is null
  ) then return false; end if;

  select count(o.id),
         coalesce(sum(greatest(o.total_minor, 0)), 0),
         max(o.created_at),
         count(o.id) filter (where o.order_type_behavior_snapshot = 'DELIVERY')
  into v_orders, v_spend_minor, v_last_order, v_delivery_orders
  from public.orders o
  join public.customer_shop_links link
    on link.legacy_customer_contact_id = o.customer_contact_id
   and link.shop_id = o.shop_id
  where link.business_id = p_business_id
    and link.canonical_customer_id = p_customer_id;

  v_loyalty_balance := public.get_admin_customer_loyalty_balance_v1(
    p_business_id, p_customer_id
  );

  return exists (
    select 1 from unnest(p_segments) chosen(segment)
    where case chosen.segment
      when 'New' then v_orders <= 1
      when 'Returning' then v_orders >= 2
      when 'VIP' then v_orders >= 10 and v_spend_minor >= 100000
      when 'Inactive 30 Days' then
        v_last_order is not null and v_last_order <= v_now - interval '30 days'
      when 'Inactive 60 Days' then
        v_last_order is not null and v_last_order <= v_now - interval '60 days'
      when 'Top Spenders' then v_spend_minor >= 120000
      when 'Frequent Delivery' then v_delivery_orders >= 4
      when 'Loyalty Members' then v_loyalty_balance > 0
      else false
    end
  );
end;
$segment_membership$;

revoke all on function private.customer_matches_promotion_segments_v1(uuid,uuid,text[])
  from public, anon, authenticated;
grant execute on function private.customer_matches_promotion_segments_v1(uuid,uuid,text[])
  to service_role;

CREATE OR REPLACE FUNCTION public.reserve_order_rewards_v1(p_business_id uuid, p_shop_id uuid, p_customer_id uuid, p_checkout_intent_id text, p_promotion_id uuid, p_loyalty_points bigint, p_channel text, p_subtotal_minor bigint, p_product_ids uuid[], p_category_ids uuid[], p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  if p_customer_id is not null and p_loyalty_points > 0 then
    perform private.expire_customer_loyalty_points_for_customer_v1(
      p_business_id,
      p_customer_id,
      p_now
    );
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
    if v_existing.status in ('CONSUMED', 'COMMITTED') then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'expiresAt', coalesce(v_existing.claim_expires_at, v_existing.expires_at),
        'snapshot', v_existing.applied_reward_snapshot
      );
    end if;
    if v_existing.status = 'CLAIMED' and (
      v_existing.claim_expires_at > p_now
      or (
        v_existing.claim_device_id is not null
        and exists (
          select 1
          from public.devices d
          join public.shop_memberships m
            on m.shop_id = d.shop_id
           and m.auth_user_id = d.auth_user_id
          where d.id = v_existing.claim_device_id
            and d.shop_id = v_existing.shop_id
            and d.active
            and m.role = 'OPERATIONS_DEVICE'
            and m.active
        )
      )
    ) then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'expiresAt', v_existing.claim_expires_at,
        'snapshot', v_existing.applied_reward_snapshot
      );
    end if;
    if v_existing.status = 'CLAIMED' and v_existing.claim_expires_at <= p_now then
      update public.reward_reservations
      set status = 'EXPIRED', updated_at = p_now
      where id = v_existing.id;
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
      and r.customer_id in (
        select c.id
        from public.business_customers c
        where c.business_id = p_business_id
          and (
            c.id = p_customer_id
            or c.merged_into_customer_id = p_customer_id
          )
      )
      and (
        r.status = 'COMMITTED'
        or (
          r.status = 'CLAIMED'
          and (
            r.claim_expires_at > p_now
            or (
              r.claim_device_id is not null
              and exists (
                select 1
                from public.devices d
                join public.shop_memberships m
                  on m.shop_id = d.shop_id
                 and m.auth_user_id = d.auth_user_id
                where d.id = r.claim_device_id
                  and d.shop_id = r.shop_id
                  and d.active
                  and m.role = 'OPERATIONS_DEVICE'
                  and m.active
              )
            )
          )
        )
        or (r.status = 'RESERVED' and r.expires_at > p_now)
      )
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
    -- The segment predicate is evaluated from canonical order/loyalty facts
    -- at database transaction time, never from a browser/device claim.
    if cardinality(v_promotion.segment_targets) > 0 and (
      p_customer_id is null
      or not private.customer_matches_promotion_segments_v1(
        p_business_id, p_customer_id, v_promotion.segment_targets
      )
    ) then
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
      and u.customer_id in (
        select c.id
        from public.business_customers c
        where c.business_id = p_business_id
          and (
            c.id = p_customer_id
            or c.merged_into_customer_id = p_customer_id
          )
      );

    select count(*)
      into v_total_reserved
    from public.reward_reservations r
    where r.promotion_id = p_promotion_id
      and (
        r.status = 'COMMITTED'
        or (
          r.status = 'CLAIMED'
          and (
            r.claim_expires_at > p_now
            or (
              r.claim_device_id is not null
              and exists (
                select 1
                from public.devices d
                join public.shop_memberships m
                  on m.shop_id = d.shop_id
                 and m.auth_user_id = d.auth_user_id
                where d.id = r.claim_device_id
                  and d.shop_id = r.shop_id
                  and d.active
                  and m.role = 'OPERATIONS_DEVICE'
                  and m.active
              )
            )
          )
        )
        or (r.status = 'RESERVED' and r.expires_at > p_now)
      )
      and (v_existing.id is null or r.id <> v_existing.id);

    select count(*)
      into v_customer_reserved
    from public.reward_reservations r
    where r.promotion_id = p_promotion_id
      and r.customer_id in (
        select c.id
        from public.business_customers c
        where c.business_id = p_business_id
          and (
            c.id = p_customer_id
            or c.merged_into_customer_id = p_customer_id
          )
      )
      and (
        r.status = 'COMMITTED'
        or (
          r.status = 'CLAIMED'
          and (
            r.claim_expires_at > p_now
            or (
              r.claim_device_id is not null
              and exists (
                select 1
                from public.devices d
                join public.shop_memberships m
                  on m.shop_id = d.shop_id
                 and m.auth_user_id = d.auth_user_id
                where d.id = r.claim_device_id
                  and d.shop_id = r.shop_id
                  and d.active
                  and m.role = 'OPERATIONS_DEVICE'
                  and m.active
              )
            )
          )
        )
        or (r.status = 'RESERVED' and r.expires_at > p_now)
      )
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

  if p_promotion_id is not null
     and p_loyalty_points > 0
     and v_promotion.stacking_policy <> 'ALLOW_CONFIGURED' then
    return jsonb_build_object('ok', false, 'code', 'reward_stacking_not_allowed');
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
        'segmentTargets', to_jsonb(v_promotion.segment_targets),
        'percentBasisPoints', v_promotion.percent_basis_points,
        'fixedDiscountMinor', v_promotion.fixed_discount_minor,
        'freeProductId', v_promotion.free_product_id,
        'minimumOrderMinor', v_promotion.minimum_order_minor,
        'channel', v_promotion.channel,
        'stackingPolicy', v_promotion.stacking_policy,
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
      claimed_at = null,
      claim_expires_at = null,
      claim_device_id = null,
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
$function$
;

-- Keep the trusted order reservation RPC's existing privileges unchanged.
revoke all on function public.reserve_order_rewards_v1(
  uuid,uuid,uuid,text,uuid,bigint,text,bigint,uuid[],uuid[],timestamptz
) from public, anon, authenticated;
grant execute on function public.reserve_order_rewards_v1(
  uuid,uuid,uuid,text,uuid,bigint,text,bigint,uuid[],uuid[],timestamptz
) to service_role;

CREATE OR REPLACE FUNCTION public.upsert_admin_promotion_v2(p_employee_id uuid, p_shop_id uuid, p_promotion_id uuid, p_name text, p_active boolean, p_kind text, p_percent_basis_points integer, p_fixed_discount_minor bigint, p_free_product_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_minimum_order_minor bigint, p_shop_ids uuid[], p_channel text, p_product_ids uuid[], p_category_ids uuid[], p_total_usage_limit bigint, p_per_customer_usage_limit bigint, p_stacking_policy text, p_expected_version bigint, p_command_id text, p_segment_targets text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
     or p_segment_targets is null
     or cardinality(p_segment_targets) > 8
     or array_position(p_segment_targets, null) is not null
     or cardinality(p_segment_targets) <> (
       select count(distinct target) from unnest(p_segment_targets) target
     )
     or not (p_segment_targets <@ array[
       'New', 'Returning', 'VIP', 'Inactive 30 Days',
       'Inactive 60 Days', 'Top Spenders', 'Frequent Delivery', 'Loyalty Members'
     ]::text[])
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
      'segmentTargets', to_jsonb(p_segment_targets),
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
      segment_targets, version, updated_by_employee_id
    ) values (
      v_id, v_business_id, btrim(p_name), p_active, p_kind, p_percent_basis_points,
      p_fixed_discount_minor, p_free_product_id, p_starts_at, p_ends_at,
      p_minimum_order_minor, p_shop_ids, p_channel, p_product_ids, p_category_ids,
      p_total_usage_limit, p_per_customer_usage_limit, p_stacking_policy,
      p_segment_targets, v_version, p_employee_id
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
        segment_targets = p_segment_targets,
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
      'stackingPolicy', p_stacking_policy,
      'segmentTargets', to_jsonb(p_segment_targets)
    ),
    null,
    null,
    null,
    jsonb_build_object('commandId', p_command_id)
  );

  return v_result;
end;
$function$
;

revoke all on function public.upsert_admin_promotion_v2(
  uuid,uuid,uuid,text,boolean,text,integer,bigint,uuid,timestamptz,
  timestamptz,bigint,uuid[],text,uuid[],uuid[],bigint,bigint,text,bigint,text,text[]
) from public, anon, authenticated;
grant execute on function public.upsert_admin_promotion_v2(
  uuid,uuid,uuid,text,boolean,text,integer,bigint,uuid,timestamptz,
  timestamptz,bigint,uuid[],text,uuid[],uuid[],bigint,bigint,text,bigint,text,text[]
) to service_role;
