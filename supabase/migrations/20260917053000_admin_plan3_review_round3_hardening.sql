-- admin_plan3_review_round3_hardening
-- Additive Plan 3 hardening for review round 3. Do not edit already-applied Plan 3 migrations.

create or replace function private.admin_text_contains_secret_v1(p_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_value text;
begin
  if p_value is null or btrim(p_value) = '' then
    return false;
  end if;

  v_value := lower(regexp_replace(p_value, '([a-z0-9])([A-Z])', '\1 \2', 'g'));

  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^a-z0-9]{1,8})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])(password|verifier|salt|lookup|token)([^a-z0-9]{1,8})([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;
