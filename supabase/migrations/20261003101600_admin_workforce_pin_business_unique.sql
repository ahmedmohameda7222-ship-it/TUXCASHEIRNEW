-- TUX Admin Plan 6: employee PIN lookup uniqueness is tenant-scoped.
-- Operations worker PIN uniqueness remains shop-scoped.
-- The previous index was global across all businesses, which coupled unrelated tenants.

drop index if exists public.business_employees_active_pin_lookup_uq;

create unique index business_employees_active_pin_lookup_uq
  on public.business_employees (business_id, pin_lookup_hash)
  where active and pin_lookup_hash is not null;
