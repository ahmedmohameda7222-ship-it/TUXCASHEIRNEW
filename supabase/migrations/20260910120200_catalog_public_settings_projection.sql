-- Customer-safe published ordering projection for TUX Menu catalog V2.
-- Repository migration only. Do not apply remotely without explicit production authorization.
--
-- The public roles receive one narrow SECURITY DEFINER capability that projects only
-- customer-facing shop identity and online-order availability from the latest immutable
-- Operations configuration snapshot. Raw bundle_json, provider integration metadata,
-- reason codes, and mutable Admin settings tables remain inaccessible.

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
    if jsonb_typeof(v_values -> 'checkout.minimumOrderMinor') <> 'number'
       or (v_values ->> 'checkout.minimumOrderMinor') !~ '^[0-9]+$' then
      return null;
    end if;
    v_minimum_order_minor := (v_values ->> 'checkout.minimumOrderMinor')::numeric;
    if v_minimum_order_minor < 0 or v_minimum_order_minor > 9007199254740991 then
      return null;
    end if;
  else
    v_minimum_order_minor := 0;
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
        and (v_identity ->> 'onlineOrdersPaused')::boolean is false,
      'temporaryClosed', (v_identity ->> 'temporaryClosed')::boolean,
      'onlineOrdersPaused', (v_identity ->> 'onlineOrdersPaused')::boolean,
      'minimumOrderMinor', v_minimum_order_minor,
      'fulfillmentPreferences', v_fulfillment_preferences,
      'paymentPreferences', v_payment_preferences
    )
  );
end;
$$;

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
