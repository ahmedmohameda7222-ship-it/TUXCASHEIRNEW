-- Exact-head cross-plan idempotency hardening discovered during Plan 6 review.
-- Order command receipts are the durable replay authority. When an approval is
-- rejected or execution fails terminally, the receipt must stop replaying the
-- original PENDING_APPROVAL snapshot so the client can safely retire that
-- command id and issue a new intent later.

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

-- Repair any terminal approval rows that predate the trigger.
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
