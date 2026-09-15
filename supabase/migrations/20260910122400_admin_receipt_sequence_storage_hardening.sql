-- TUX Admin Plan 2 receipt sequence remote-storage hardening.
-- `receipt.sequenceStart` remains bounded by its existing trusted setting policy, but
-- a valid Business Day can allocate subsequent display numbers beyond PostgreSQL int4.
-- Keep the remote materialization columns aligned with the domain's safe-integer allocator.

alter table public.business_days
  alter column last_allocated_display_order_no type bigint
  using last_allocated_display_order_no::bigint;

alter table public.orders
  alter column display_order_no type bigint
  using display_order_no::bigint;
