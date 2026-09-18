-- admin_plan3_review_round10_hardening
-- Additive Plan 3 hardening for Codex review round 10. Do not edit already-applied migrations.

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

  -- Support compact disclosures such as PIN4827/passcode1234 as well as narrative separators.
  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^0-9]{0,32})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  -- Credential labels fail closed because immutable approval/audit reasons must never retain their values.
  if v_value ~ '(^|[^a-z0-9])(password|verifier|lookup|token)([^a-z0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])(api[[:space:]_-]*key|client[[:space:]_-]*secret|access[[:space:]_-]*key|secret[[:space:]_-]*key|private[[:space:]_-]*key)([^a-z0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])salt((([[:space:][:punct:]]+)(is|was|were|to|as|equals?)([[:space:][:punct:]]{1,8}))|([[:punct:]]{1,8}[[:space:]]*))([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;
