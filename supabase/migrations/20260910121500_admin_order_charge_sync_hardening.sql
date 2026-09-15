-- Preserve trusted checkout charge components in the remote Operations order projection.
-- Existing orders remain valid because both new components default to zero.

alter table public.orders
  add column if not exists service_charge_minor bigint not null default 0
    check (service_charge_minor >= 0);

alter table public.orders
  add column if not exists tax_minor bigint not null default 0
    check (tax_minor >= 0);

alter table public.orders
  drop constraint if exists orders_check1;

alter table public.orders
  drop constraint if exists orders_total_components_ck;

alter table public.orders
  add constraint orders_total_components_ck check (
    total_minor = items_subtotal_minor - discount_minor + final_delivery_fee_minor + service_charge_minor + tax_minor
  );
