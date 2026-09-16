-- TUX Admin Plan 2 receipt sequence storage-range hardening.
-- The downstream receipt/order sequence columns are PostgreSQL int4, so trusted settings
-- must reject values that cannot be materialized by Operations.

create or replace function private.validate_admin_setting_value_v1(
  p_setting_key text,
  p_value_json jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_number numeric;
  v_text text;
begin
  if p_setting_key is null or p_value_json is null then
    return false;
  end if;

  case p_setting_key
    when 'checkout.minimumOrderMinor' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 9007199254740991;

    when 'checkout.serviceChargeBps', 'checkout.taxBps' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 10000;

    when 'checkout.requireCustomerPhone',
         'checkout.allowDiscountStacking',
         'checkout.allowDeliveryFeeOverride' then
      return jsonb_typeof(p_value_json) = 'boolean';

    when 'receipt.orderPrefix' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 64;

    when 'receipt.footer' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 1000;

    when 'receipt.sequenceStart' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 1 and 2147483647;

    when 'receipt.sequenceResetPolicy' then
      return jsonb_typeof(p_value_json) = 'string'
        and (p_value_json #>> '{}') = 'BUSINESS_DAY';

    else
      return false;
  end case;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.validate_admin_setting_value_v1(text, jsonb)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function private.validate_admin_setting_value_v1(text, jsonb)
      to service_role;
  end if;
end $$;
