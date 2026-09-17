-- admin_plan3_review_round7_hardening
-- Additive Plan 3 hardening for final review round 7. Do not edit already-applied migrations.
-- Fail closed on free-text credential labels so narrative connector wording cannot disclose secrets.

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

  -- PIN/passcode values have a constrained 4-12 digit shape. Scan a bounded natural-language
  -- gap so connector wording cannot bypass detection while unrelated uses of the words remain valid.
  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^0-9]{1,32})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  -- Password/verifier/lookup/token labels are themselves sensitive in immutable approval/audit
  -- reasons. Reject the bounded label regardless of connector wording instead of maintaining an
  -- incomplete connector allowlist (for example: "password is now hunter2").
  if v_value ~ '(^|[^a-z0-9])(password|verifier|lookup|token)([^a-z0-9]|$)' then
    return true;
  end if;

  -- "salt" is common restaurant vocabulary. Require either an explicit connector or punctuation
  -- before treating the following token as credential material, so "Salt inventory count adjusted"
  -- remains a legitimate audit reason while "salt was abcdef" and "salt: abcdef" fail closed.
  if v_value ~ '(^|[^a-z0-9])salt((([[:space:][:punct:]]+)(is|was|were|to|as|equals?)([[:space:][:punct:]]{1,8}))|([[:punct:]]{1,8}[[:space:]]*))([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;
