-- Plan 7: materialize payment effects at the canonical database trust boundary.
-- Payment capture and refund authorization remain owned by Operations/Orders.
-- An absent/historically inapplicable mapping NEVER blocks payment capture.

create or replace function private.materialize_finance_sale_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_business_id uuid;
  v_worker_id uuid;
  v_account_id uuid;
  v_payload jsonb;
  v_fingerprint text;
begin
  if new.allocated_minor <= 0 then
    return new;
  end if;

  -- Resolve an actual worker and a current explicit payment-to-account mapping.
  -- Reject retroactive attribution if mapping was created or changed after the
  -- payment's original event timestamp.
  select bs.business_id, o.operator_worker_id, m.finance_account_id
    into v_business_id, v_worker_id, v_account_id
  from public.orders o
  join public.business_shops bs on bs.shop_id = o.shop_id
  join public.payment_method_finance_accounts m
    on m.business_id = bs.business_id
   and m.shop_id = new.shop_id
   and m.payment_method_id = new.payment_method_id
   and m.active
   and new.created_at >= m.updated_at
  join public.finance_accounts a
    on a.business_id = m.business_id and a.id = m.finance_account_id
   and a.active and (a.shop_id is null or a.shop_id = new.shop_id)
  where o.id = new.order_id and o.shop_id = new.shop_id
  limit 1;

  if v_account_id is null or v_worker_id is null then
    return new; -- unmapped or historical: reconciliation gap, never inferred
  end if;

  v_payload := jsonb_build_object(
    'sourceKind','PAYMENT',
    'sourceId',new.id,
    'movementType','SALE',
    'shopId',new.shop_id,
    'accountId',v_account_id,
    'allocatedMinor',new.allocated_minor,
    'workerId',v_worker_id
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');

  insert into public.finance_movements(
    business_id,shop_id,finance_account_id,movement_type,amount_minor,
    command_id,command_effect,request_fingerprint,
    actor_employee_id,actor_worker_id,source_kind,source_id,source_effect
  ) values (
    v_business_id,new.shop_id,v_account_id,'SALE',new.allocated_minor,
    'plan7:payment:'||new.id::text,'PRIMARY',v_fingerprint,
    null,v_worker_id,'PAYMENT',new.id::text,'SALE'
  ) on conflict do nothing;

  return new;
exception when others then
  -- Operational payment capture has priority. Surface unmaterialized payments
  -- in reconciliation reports rather than roll back Operations.
  raise warning 'TUX_FINANCE_SALE_MATERIALIZATION_GAP: %', SQLSTATE;
  return new;
end;
$$;

create trigger payments_finance_sale_materialization
after insert on public.payments
for each row execute function private.materialize_finance_sale_v1();


create or replace function private.materialize_posted_finance_refund_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_original public.finance_movements%rowtype;
  v_payload jsonb;
begin
  if new.state <> 'POSTED' or (tg_op = 'UPDATE' and old.state = 'POSTED') then
    return new;
  end if;
  if new.amount_minor <= 0 then
    return new;
  end if;

  -- Original SALE attribution is the only authority: never apply today's
  -- payment-method mapping to an unmapped historical payment.
  select fm.* into v_original
  from public.finance_movements fm
  where fm.business_id = new.business_id
    and fm.shop_id = new.shop_id
    and fm.movement_type = 'SALE'
    and fm.source_kind = 'PAYMENT'
    and fm.source_id = new.payment_id::text
    and fm.source_effect = 'SALE'
  limit 1;

  if v_original.id is null then
    return new; -- source never mapped; reconciliation must show gap
  end if;

  v_payload := jsonb_build_object(
    'sourceKind','ADMIN_ORDER_REFUND',
    'sourceId',new.id,
    'movementType','REFUND',
    'originalPaymentId',new.payment_id,
    'accountId',v_original.finance_account_id,
    'amountMinor',new.amount_minor,
    'employeeId',new.created_by_employee_id
  );

  insert into public.finance_movements(
    business_id,shop_id,finance_account_id,movement_type,amount_minor,
    command_id,command_effect,request_fingerprint,
    actor_employee_id,actor_worker_id,source_kind,source_id,source_effect
  ) values (
    new.business_id,new.shop_id,v_original.finance_account_id,
    'REFUND',-new.amount_minor,
    'plan7:refund:'||new.id::text,'PRIMARY',
    encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex'),
    new.created_by_employee_id,null,'ADMIN_ORDER_REFUND',new.id::text,'REFUND'
  ) on conflict do nothing;

  return new;
exception when others then
  raise warning 'TUX_FINANCE_REFUND_MATERIALIZATION_GAP: %', SQLSTATE;
  return new;
end;
$$;

create trigger admin_order_refunds_finance_materialization
after insert or update of state on public.admin_order_refunds
for each row execute function private.materialize_posted_finance_refund_v1();

revoke all on function private.materialize_finance_sale_v1()
  from public, anon, authenticated;
revoke all on function private.materialize_posted_finance_refund_v1()
  from public, anon, authenticated;

comment on function private.materialize_finance_sale_v1() is
  'Only explicit payment-time mapping materializes allocated (not received) SALE; skipped source remains visible as a reconciliation gap.';
comment on function private.materialize_posted_finance_refund_v1() is
  'Only POSTED refund reuses original historical payment attribution; pending effects are not booked.';
