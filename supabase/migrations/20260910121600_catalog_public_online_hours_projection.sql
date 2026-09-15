-- Apply published ONLINE weekly/special service hours to customer-safe ordering availability.
-- This remains rollout-compatible: shops with no ONLINE hours configured retain lifecycle-based availability.

create or replace function private.catalog_public_local_minute_v1(p_value text)
returns integer
language plpgsql
immutable
set search_path = pg_catalog, private
as $$
declare
  v_hour integer;
  v_minute integer;
begin
  if p_value is null
     or p_value !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?$' then
    return null;
  end if;

  v_hour := substring(p_value from 1 for 2)::integer;
  v_minute := substring(p_value from 4 for 2)::integer;
  if v_hour > 23 or v_minute > 59 then
    return null;
  end if;

  return v_hour * 60 + v_minute;
end;
$$;

create or replace function private.catalog_public_online_ordering_open_v1(
  p_settings jsonb,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, private
as $$
declare
  v_weekly jsonb;
  v_special jsonb;
  v_local timestamp without time zone;
  v_service_date date;
  v_day_of_week integer;
  v_minute_of_day integer;
  v_previous_day integer;
  v_current_special jsonb;
  v_previous_special jsonb;
  v_hours jsonb;
  v_opens integer;
  v_closes integer;
  v_has_online_weekly boolean;
  v_has_online_special boolean;
begin
  if jsonb_typeof(p_settings) <> 'object' or p_now is null then
    return false;
  end if;

  v_weekly := coalesce(p_settings -> 'weeklyHours', '[]'::jsonb);
  v_special := coalesce(p_settings -> 'specialHours', '[]'::jsonb);
  if jsonb_typeof(v_weekly) <> 'array' or jsonb_typeof(v_special) <> 'array' then
    return false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_weekly) hours
    where jsonb_typeof(hours) = 'object'
      and hours ->> 'serviceKind' = 'ONLINE'
      and hours ->> 'active' = 'true'
  ) into v_has_online_weekly;

  select exists (
    select 1
    from jsonb_array_elements(v_special) hours
    where jsonb_typeof(hours) = 'object'
      and hours ->> 'serviceKind' = 'ONLINE'
  ) into v_has_online_special;

  if not v_has_online_weekly and not v_has_online_special then
    return true;
  end if;

  v_local := p_now at time zone 'Africa/Cairo';
  v_service_date := v_local::date;
  v_day_of_week := extract(dow from v_local)::integer;
  v_minute_of_day := extract(hour from v_local)::integer * 60
    + extract(minute from v_local)::integer;

  select candidate.hours
    into v_current_special
  from jsonb_array_elements(v_special) with ordinality candidate(hours, ordinality)
  where jsonb_typeof(candidate.hours) = 'object'
    and candidate.hours ->> 'serviceKind' = 'ONLINE'
    and candidate.hours ->> 'serviceDate' = to_char(v_service_date, 'YYYY-MM-DD')
  order by candidate.ordinality
  limit 1;

  if found then
    if jsonb_typeof(v_current_special -> 'closed') <> 'boolean'
       or (v_current_special ->> 'closed')::boolean
       or jsonb_typeof(v_current_special -> 'opensLocal') <> 'string'
       or jsonb_typeof(v_current_special -> 'closesLocal') <> 'string' then
      return false;
    end if;

    v_opens := private.catalog_public_local_minute_v1(v_current_special ->> 'opensLocal');
    v_closes := private.catalog_public_local_minute_v1(v_current_special ->> 'closesLocal');
    if v_opens is null or v_closes is null then
      return false;
    end if;

    if v_opens < v_closes then
      return v_minute_of_day >= v_opens and v_minute_of_day < v_closes;
    end if;
    return v_minute_of_day >= v_opens;
  end if;

  select candidate.hours
    into v_previous_special
  from jsonb_array_elements(v_special) with ordinality candidate(hours, ordinality)
  where jsonb_typeof(candidate.hours) = 'object'
    and candidate.hours ->> 'serviceKind' = 'ONLINE'
    and candidate.hours ->> 'serviceDate' = to_char(v_service_date - 1, 'YYYY-MM-DD')
  order by candidate.ordinality
  limit 1;

  if found then
    if jsonb_typeof(v_previous_special -> 'closed') = 'boolean'
       and (v_previous_special ->> 'closed')::boolean is false
       and jsonb_typeof(v_previous_special -> 'opensLocal') = 'string'
       and jsonb_typeof(v_previous_special -> 'closesLocal') = 'string' then
      v_opens := private.catalog_public_local_minute_v1(v_previous_special ->> 'opensLocal');
      v_closes := private.catalog_public_local_minute_v1(v_previous_special ->> 'closesLocal');
      if v_opens is null or v_closes is null then
        return false;
      end if;
      if v_closes < v_opens and v_minute_of_day < v_closes then
        return true;
      end if;
    end if;
  else
    v_previous_day := (v_day_of_week + 6) % 7;
    for v_hours in
      select candidate.hours
      from jsonb_array_elements(v_weekly) with ordinality candidate(hours, ordinality)
      where jsonb_typeof(candidate.hours) = 'object'
        and candidate.hours ->> 'serviceKind' = 'ONLINE'
        and candidate.hours ->> 'active' = 'true'
        and candidate.hours ->> 'dayOfWeek' ~ '^[0-6]$'
        and (candidate.hours ->> 'dayOfWeek')::integer = v_previous_day
      order by candidate.ordinality
    loop
      if jsonb_typeof(v_hours -> 'opensLocal') <> 'string'
         or jsonb_typeof(v_hours -> 'closesLocal') <> 'string' then
        return false;
      end if;
      v_opens := private.catalog_public_local_minute_v1(v_hours ->> 'opensLocal');
      v_closes := private.catalog_public_local_minute_v1(v_hours ->> 'closesLocal');
      if v_opens is null or v_closes is null then
        return false;
      end if;
      if v_closes < v_opens and v_minute_of_day < v_closes then
        return true;
      end if;
    end loop;
  end if;

  for v_hours in
    select candidate.hours
    from jsonb_array_elements(v_weekly) with ordinality candidate(hours, ordinality)
    where jsonb_typeof(candidate.hours) = 'object'
      and candidate.hours ->> 'serviceKind' = 'ONLINE'
      and candidate.hours ->> 'active' = 'true'
      and candidate.hours ->> 'dayOfWeek' ~ '^[0-6]$'
      and (candidate.hours ->> 'dayOfWeek')::integer = v_day_of_week
    order by candidate.ordinality
  loop
    if jsonb_typeof(v_hours -> 'opensLocal') <> 'string'
       or jsonb_typeof(v_hours -> 'closesLocal') <> 'string' then
      return false;
    end if;
    v_opens := private.catalog_public_local_minute_v1(v_hours ->> 'opensLocal');
    v_closes := private.catalog_public_local_minute_v1(v_hours ->> 'closesLocal');
    if v_opens is null or v_closes is null then
      return false;
    end if;
    if v_opens < v_closes then
      if v_minute_of_day >= v_opens and v_minute_of_day < v_closes then
        return true;
      end if;
    elsif v_minute_of_day >= v_opens then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.read_catalog_public_ordering_v2(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bundle jsonb;
  v_snapshot jsonb;
  v_settings jsonb;
  v_identity jsonb;
  v_values jsonb;
  v_order_types jsonb;
  v_payment_methods jsonb;
  v_minimum_order_minor numeric;
  v_service_charge_bps numeric;
  v_tax_bps numeric;
  v_allow_discount_stacking boolean;
  v_require_customer_phone boolean;
  v_has_pickup boolean;
  v_has_delivery boolean;
  v_has_cash boolean;
  v_has_instapay boolean;
  v_fulfillment_preferences jsonb := '[]'::jsonb;
  v_payment_preferences jsonb := '[]'::jsonb;
begin
  if p_shop_id is null then
    return null;
  end if;

  select configuration.bundle_json
    into v_bundle
  from public.operations_configuration_snapshots configuration
  where configuration.shop_id = p_shop_id
  order by configuration.version desc
  limit 1;

  if v_bundle is null or jsonb_typeof(v_bundle) <> 'object' then
    return null;
  end if;

  v_snapshot := v_bundle -> 'snapshot';
  if jsonb_typeof(v_snapshot) <> 'object'
     or v_snapshot ->> 'shopId' is distinct from p_shop_id::text then
    return null;
  end if;

  v_settings := v_snapshot -> 'settings';
  if jsonb_typeof(v_settings) <> 'object' then
    return null;
  end if;

  v_identity := v_settings -> 'shopIdentity';
  v_values := v_settings -> 'values';
  v_order_types := v_snapshot -> 'orderTypes';
  v_payment_methods := v_snapshot -> 'paymentMethods';

  if jsonb_typeof(v_identity) <> 'object'
     or v_identity ->> 'shopId' is distinct from p_shop_id::text
     or jsonb_typeof(v_values) <> 'object'
     or jsonb_typeof(v_order_types) <> 'array'
     or jsonb_typeof(v_payment_methods) <> 'array'
     or jsonb_typeof(v_identity -> 'displayName') <> 'string'
     or jsonb_typeof(v_identity -> 'temporaryClosed') <> 'boolean'
     or jsonb_typeof(v_identity -> 'onlineOrdersPaused') <> 'boolean'
     or jsonb_typeof(v_identity -> 'lifecycleState') <> 'string' then
    return null;
  end if;

  if v_values ? 'checkout.minimumOrderMinor' then
    if jsonb_typeof(v_values -> 'checkout.minimumOrderMinor') <> 'number' then
      return null;
    end if;
    v_minimum_order_minor := (v_values ->> 'checkout.minimumOrderMinor')::numeric;
    if v_minimum_order_minor <> trunc(v_minimum_order_minor)
       or v_minimum_order_minor < 0
       or v_minimum_order_minor > 9007199254740991 then
      return null;
    end if;
  else
    v_minimum_order_minor := 0;
  end if;

  if v_values ? 'checkout.serviceChargeBps' then
    if jsonb_typeof(v_values -> 'checkout.serviceChargeBps') <> 'number' then
      return null;
    end if;
    v_service_charge_bps := (v_values ->> 'checkout.serviceChargeBps')::numeric;
    if v_service_charge_bps <> trunc(v_service_charge_bps)
       or v_service_charge_bps < 0
       or v_service_charge_bps > 10000 then
      return null;
    end if;
  else
    v_service_charge_bps := 0;
  end if;

  if v_values ? 'checkout.taxBps' then
    if jsonb_typeof(v_values -> 'checkout.taxBps') <> 'number' then
      return null;
    end if;
    v_tax_bps := (v_values ->> 'checkout.taxBps')::numeric;
    if v_tax_bps <> trunc(v_tax_bps)
       or v_tax_bps < 0
       or v_tax_bps > 10000 then
      return null;
    end if;
  else
    v_tax_bps := 0;
  end if;

  if v_values ? 'checkout.allowDiscountStacking' then
    if jsonb_typeof(v_values -> 'checkout.allowDiscountStacking') <> 'boolean' then
      return null;
    end if;
    v_allow_discount_stacking := (v_values ->> 'checkout.allowDiscountStacking')::boolean;
  else
    v_allow_discount_stacking := false;
  end if;

  if v_values ? 'checkout.requireCustomerPhone' then
    if jsonb_typeof(v_values -> 'checkout.requireCustomerPhone') <> 'boolean' then
      return null;
    end if;
    v_require_customer_phone := (v_values ->> 'checkout.requireCustomerPhone')::boolean;
  else
    v_require_customer_phone := false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_order_types) order_type
    where jsonb_typeof(order_type) = 'object'
      and order_type ->> 'active' = 'true'
      and order_type ->> 'behavior' = 'TAKE_AWAY'
  ) into v_has_pickup;

  select exists (
    select 1
    from jsonb_array_elements(v_order_types) order_type
    where jsonb_typeof(order_type) = 'object'
      and order_type ->> 'active' = 'true'
      and order_type ->> 'behavior' = 'DELIVERY'
  ) into v_has_delivery;

  if v_has_pickup then
    v_fulfillment_preferences := v_fulfillment_preferences || jsonb_build_array('PICKUP');
  end if;
  if v_has_delivery then
    v_fulfillment_preferences := v_fulfillment_preferences || jsonb_build_array('DELIVERY');
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_payment_methods) payment_method
    where jsonb_typeof(payment_method) = 'object'
      and payment_method ->> 'active' = 'true'
      and coalesce(payment_method ->> 'channel', 'BOTH') in ('ONLINE', 'BOTH')
      and payment_method ->> 'logicType' = 'CASH'
  ) into v_has_cash;

  select exists (
    select 1
    from jsonb_array_elements(v_payment_methods) payment_method
    where jsonb_typeof(payment_method) = 'object'
      and payment_method ->> 'active' = 'true'
      and coalesce(payment_method ->> 'channel', 'BOTH') in ('ONLINE', 'BOTH')
      and payment_method ->> 'logicType' = 'DIGITAL'
      and (
        upper(btrim(payment_method ->> 'integrationReference')) = 'INSTAPAY'
        or (
          payment_method ->> 'integrationReference' is null
          and upper(regexp_replace(coalesce(payment_method ->> 'displayName', ''), '\s+', '', 'g')) = 'INSTAPAY'
        )
      )
  ) into v_has_instapay;

  if v_has_cash then
    v_payment_preferences := v_payment_preferences || jsonb_build_array('CASH');
  end if;
  if v_has_instapay then
    v_payment_preferences := v_payment_preferences || jsonb_build_array('INSTAPAY');
  end if;
  if v_has_cash and v_has_instapay then
    v_payment_preferences := v_payment_preferences || jsonb_build_array('MIXED');
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'displayName', v_identity ->> 'displayName',
      'address', case
        when jsonb_typeof(v_identity -> 'address') = 'string' then v_identity ->> 'address'
        else null
      end,
      'phone', case
        when jsonb_typeof(v_identity -> 'phone') = 'string' then v_identity ->> 'phone'
        else null
      end,
      'latitude', case
        when jsonb_typeof(v_identity -> 'latitude') = 'number' then v_identity -> 'latitude'
        else 'null'::jsonb
      end,
      'longitude', case
        when jsonb_typeof(v_identity -> 'longitude') = 'number' then v_identity -> 'longitude'
        else 'null'::jsonb
      end
    ),
    'ordering', jsonb_build_object(
      'available',
        (v_identity ->> 'lifecycleState') = 'ACTIVE'
        and (v_identity ->> 'temporaryClosed')::boolean is false
        and (v_identity ->> 'onlineOrdersPaused')::boolean is false
        and private.catalog_public_online_ordering_open_v1(v_settings, now()),
      'temporaryClosed', (v_identity ->> 'temporaryClosed')::boolean,
      'onlineOrdersPaused', (v_identity ->> 'onlineOrdersPaused')::boolean,
      'minimumOrderMinor', v_minimum_order_minor,
      'serviceChargeBps', v_service_charge_bps,
      'taxBps', v_tax_bps,
      'allowDiscountStacking', v_allow_discount_stacking,
      'requireCustomerPhone', v_require_customer_phone,
      'fulfillmentPreferences', v_fulfillment_preferences,
      'paymentPreferences', v_payment_preferences
    )
  );
end;
$$;

revoke all on function private.catalog_public_local_minute_v1(text) from public;
revoke all on function private.catalog_public_online_ordering_open_v1(jsonb, timestamptz) from public;
revoke all on function public.read_catalog_public_ordering_v2(uuid) from public;

do $$
begin
  if to_regrole('anon') is not null then
    grant execute on function public.read_catalog_public_ordering_v2(uuid) to anon;
  end if;
  if to_regrole('authenticated') is not null then
    grant execute on function public.read_catalog_public_ordering_v2(uuid) to authenticated;
  end if;
end $$;
