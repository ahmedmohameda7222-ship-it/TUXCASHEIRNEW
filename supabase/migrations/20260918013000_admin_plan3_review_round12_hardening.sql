-- admin_plan3_review_round12_hardening
-- Additive Plan 3 hardening for acronym-style structured credential keys.

create or replace function private.admin_json_contains_secret_key_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_key text;
  v_child jsonb;
  v_normalized_key text;
  v_collapsed_key text;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      v_normalized_key := lower(
        replace(
          replace(
            regexp_replace(v_key, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
            '-',
            '_'
          ),
          ' ',
          '_'
        )
      );
      v_collapsed_key := replace(v_normalized_key, '_', '');

      if v_normalized_key ~ '(^|_)(pin|password|passcode|verifier|salt|lookup|token)(_|$)'
         or v_normalized_key in (
           'api_key', 'client_secret', 'access_key', 'secret_key', 'private_key'
         )
         or v_collapsed_key in (
           'pinhash', 'pinlookuphash', 'pinverifier', 'pinsalt',
           'passwordhash', 'passwordverifier', 'claimtoken',
           'apikey', 'clientsecret', 'accesskey', 'secretkey', 'privatekey'
         ) then
        return true;
      end if;

      if private.admin_json_contains_secret_key_v1(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if private.admin_json_contains_secret_key_v1(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_json_contains_secret_key_v1(jsonb)
  from public, anon, authenticated;
