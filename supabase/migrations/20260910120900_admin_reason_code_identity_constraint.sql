-- TUX Admin Plan 2 reason-code storage compatibility hardening.
-- Operator-authorized remote application: the user explicitly authorized applying required
-- Plan 2 migrations to canonical Supabase project awpdcsayuwbsruwvaosg and synchronizing history.
-- Existing stable reason identities may use uppercase characters (for example CUSTOMER_CHANGED_MIND).

-- Replace the original lowercase-only inline CHECK from admin_shop_settings with the same
-- mixed-case stable-key contract enforced by the Admin API and trusted upsert RPC.
do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.admin_reason_codes'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%reason_key%'
  loop
    execute format(
      'alter table public.admin_reason_codes drop constraint %I',
      v_constraint_name
    );
  end loop;
end $$;

alter table public.admin_reason_codes
  add constraint admin_reason_codes_reason_key_format_ck
  check (reason_key ~ '^[A-Za-z][A-Za-z0-9_-]*$');
