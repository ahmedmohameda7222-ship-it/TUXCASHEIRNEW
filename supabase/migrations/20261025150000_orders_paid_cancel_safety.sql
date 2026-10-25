-- Orders production remediation: explicitly reject Admin cancellation of an ACTIVE
-- order with allocated payments. No refund reversal is fabricated here.
--
-- The existing Admin refund RPC only authorizes DONE or RETURNED orders.
-- Rejecting the unsafe state transition is the conservative forward-only
-- policy until a coordinated paid-cancellation settlement workflow exists.
-- The trigger executes within the authoritative order-row UPDATE transaction;
-- it cannot be bypassed by omitting client-side guards or using old Admin UI.
--
-- Only Admin-origin cancellation is fenced. Operations transitions are not
-- rewritten by this migration, and existing historical rows are untouched.

create or replace function private.reject_paid_active_admin_cancellation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $orders_paid_cancel_guard$
begin
  if old.status = 'ACTIVE'
     and new.status = 'CANCELLED'
     and new.cancelled_by_admin_employee_id is not null
     and exists (
       select 1
       from public.payments p
       where p.shop_id = old.shop_id
         and p.order_id = old.id
         and p.allocated_minor > 0
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'TUX_ADMIN_PAID_CANCEL_REQUIRES_SETTLEMENT';
  end if;
  return new;
end;
$orders_paid_cancel_guard$;

revoke all on function private.reject_paid_active_admin_cancellation_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_paid_admin_cancel_guard on public.orders;

create trigger orders_paid_admin_cancel_guard
before update of status on public.orders
for each row
execute function private.reject_paid_active_admin_cancellation_v1();

comment on function private.reject_paid_active_admin_cancellation_v1()
is 'Rejects paid ACTIVE to CANCELLED Admin transitions; no automatic refund or external provider reversal.';
