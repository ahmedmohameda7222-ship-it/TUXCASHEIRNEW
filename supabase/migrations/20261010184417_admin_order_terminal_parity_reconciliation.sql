-- Forward-only Plan 5 terminal approval reconciliation. Original reviewed SQL
-- was not deployed under its historical migration timestamp. Live semantic delta verified 2026-10-10.
-- Exact-head cross-plan lifecycle/idempotency hardening discovered during Plan 6 review.
-- Order financial rows and durable command receipts must converge when an
-- approval becomes terminal. Otherwise history can remain labeled
-- PENDING_APPROVAL and retries can replay a stale pending snapshot forever.

alter table public.admin_order_refunds
  drop constraint if exists admin_order_refunds_state_check;
alter table public.admin_order_refunds
  add constraint admin_order_refunds_state_check
  check (state in ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'FAILED'));

alter table public.admin_order_returns
  drop constraint if exists admin_order_returns_state_check;
alter table public.admin_order_returns
  add constraint admin_order_returns_state_check
  check (state in ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'FAILED'));

create or replace function private.sync_admin_order_terminal_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_order_command_id text;
  v_command_type text;
  v_code text;
begin
  if new.status not in ('REJECTED', 'FAILED')
     or new.status is not distinct from old.status then
    return new;
  end if;

  if new.action_type = 'ORDER_REFUND' then
    v_command_type := 'REFUND';
  elsif new.action_type = 'ORDER_RETURN' then
    v_command_type := 'RETURN';
  else
    return new;
  end if;

  v_order_command_id := nullif(btrim(new.command_payload ->> 'orderCommandId'), '');
  if v_order_command_id is null then
    return new;
  end if;

  v_code := case new.status
    when 'REJECTED' then 'approval_rejected'
    else 'approval_execution_failed'
  end;

  update public.admin_order_command_receipts receipt
  set result_json = jsonb_build_object('ok', false, 'code', v_code)
  where receipt.business_id = new.business_id
    and receipt.shop_id is not distinct from new.shop_id
    and receipt.command_id = v_order_command_id
    and receipt.command_type = v_command_type
    and receipt.result_json ->> 'state' = 'PENDING_APPROVAL'
    and receipt.result_json ->> 'approvalRequestId' = new.id::text;

  if new.action_type = 'ORDER_REFUND' then
    update public.admin_order_refunds refund
    set state = new.status
    where refund.business_id = new.business_id
      and refund.shop_id is not distinct from new.shop_id
      and refund.approval_request_id = new.id
      and refund.command_id = v_order_command_id
      and refund.state = 'PENDING_APPROVAL';
  else
    update public.admin_order_returns order_return
    set state = new.status
    where order_return.business_id = new.business_id
      and order_return.shop_id is not distinct from new.shop_id
      and order_return.approval_request_id = new.id
      and order_return.command_id = v_order_command_id
      and order_return.state = 'PENDING_APPROVAL';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_admin_order_terminal_receipt_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists admin_order_terminal_approval_receipt
  on public.admin_approval_requests;

create trigger admin_order_terminal_approval_receipt
after update of status on public.admin_approval_requests
for each row
when (new.status in ('REJECTED', 'FAILED'))
execute function private.sync_admin_order_terminal_receipt_v1();

-- Repair terminal approval rows that predate the trigger.
update public.admin_order_command_receipts receipt
set result_json = jsonb_build_object(
  'ok', false,
  'code', case approval.status
    when 'REJECTED' then 'approval_rejected'
    else 'approval_execution_failed'
  end
)
from public.admin_approval_requests approval
where approval.status in ('REJECTED', 'FAILED')
  and approval.action_type in ('ORDER_REFUND', 'ORDER_RETURN')
  and receipt.business_id = approval.business_id
  and receipt.shop_id is not distinct from approval.shop_id
  and receipt.command_id = nullif(btrim(approval.command_payload ->> 'orderCommandId'), '')
  and receipt.command_type = case approval.action_type
    when 'ORDER_REFUND' then 'REFUND'
    else 'RETURN'
  end
  and receipt.result_json ->> 'state' = 'PENDING_APPROVAL'
  and receipt.result_json ->> 'approvalRequestId' = approval.id::text;

update public.admin_order_refunds refund
set state = approval.status
from public.admin_approval_requests approval
where approval.status in ('REJECTED', 'FAILED')
  and approval.action_type = 'ORDER_REFUND'
  and refund.business_id = approval.business_id
  and refund.shop_id is not distinct from approval.shop_id
  and refund.approval_request_id = approval.id
  and refund.command_id = nullif(btrim(approval.command_payload ->> 'orderCommandId'), '')
  and refund.state = 'PENDING_APPROVAL';

update public.admin_order_returns order_return
set state = approval.status
from public.admin_approval_requests approval
where approval.status in ('REJECTED', 'FAILED')
  and approval.action_type = 'ORDER_RETURN'
  and order_return.business_id = approval.business_id
  and order_return.shop_id is not distinct from approval.shop_id
  and order_return.approval_request_id = approval.id
  and order_return.command_id = nullif(btrim(approval.command_payload ->> 'orderCommandId'), '')
  and order_return.state = 'PENDING_APPROVAL';
