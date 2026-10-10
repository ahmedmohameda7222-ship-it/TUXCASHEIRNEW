-- Forward-only Plan 6 PIN tenant-scope parity with reviewed 016/018 semantics.
-- The canonical database still contained global uniqueness on both keys.
-- TUX Admin Plan 6: employee PIN lookup uniqueness is tenant-scoped.
-- Operations worker PIN uniqueness remains shop-scoped.
-- The previous index was global across all businesses, which coupled unrelated tenants.

drop index if exists public.business_employees_active_pin_lookup_uq;

create unique index business_employees_active_pin_lookup_uq
  on public.business_employees (business_id, pin_lookup_hash)
  where active and pin_lookup_hash is not null;


-- Command idempotency belongs to a business, not the global UUID namespace.
alter table private.admin_employee_pin_change_commands
  drop constraint if exists admin_employee_pin_change_commands_command_id_key;

alter table private.admin_employee_pin_change_commands
  drop constraint if exists admin_employee_pin_change_commands_business_command_uq;

alter table private.admin_employee_pin_change_commands
  add constraint admin_employee_pin_change_commands_business_command_uq
  unique (business_id, command_id);
