-- Plan 7 expected cashier reconciliation and recurring expense definitions.
create or replace function public.finance_cashier_expectations_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_business_id uuid;v_authorized boolean;v_rows jsonb;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.view') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if not exists(select 1 from public.business_days d
    where d.id=p_business_day_id and d.shop_id=p_shop_id) then
    return jsonb_build_object('ok',false,'code','finance_day_not_found');
  end if;
  with receipts as (
    select o.operator_worker_id worker_id,
      sum(p.allocated_minor)::bigint cash_in
    from public.payments p
    join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
    where o.shop_id=p_shop_id and o.business_day_id=p_business_day_id
      and p.logic_type_snapshot='CASH'
    group by o.operator_worker_id
  ),
  refunded as (
    select o.operator_worker_id worker_id,sum(r.amount_minor)::bigint cash_out
    from public.admin_order_refunds r
    join public.payments p on p.id=r.payment_id and p.shop_id=r.shop_id
    join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
    where r.business_id=v_business_id and r.shop_id=p_shop_id
      and r.state='POSTED' and o.business_day_id=p_business_day_id
      and p.logic_type_snapshot='CASH'
    group by o.operator_worker_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'cashierWorkerId',w.id,'displayName',w.display_name,
    'cashCollectedMinor',coalesce(rc.cash_in,0),
    'postedCashRefundsMinor',coalesce(rf.cash_out,0),
    'expectedMinor',coalesce(rc.cash_in,0)-coalesce(rf.cash_out,0),
    'actualMinor',rec.actual_minor,
    'varianceMinor',rec.variance_minor,
    'reconciled',rec.id is not null
  ) order by w.display_name,w.id),'[]'::jsonb) into v_rows
  from public.workers w
  join receipts rc on rc.worker_id=w.id
  left join refunded rf on rf.worker_id=w.id
  left join public.cashier_reconciliations rec
    on rec.shop_id=p_shop_id and rec.business_day_id=p_business_day_id
       and rec.cashier_worker_id=w.id
  where w.shop_id=p_shop_id;
  return jsonb_build_object('ok',true,'cashiers',v_rows);
end;
$$;

create table public.recurring_expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  rule_id uuid not null,
  due_on date not null,
  amount_minor bigint not null check(amount_minor>0),
  description_snapshot text not null check(btrim(description_snapshot)<>''),
  category_id uuid,
  rule_version bigint not null check(rule_version>0),
  status text not null default 'DUE' check(status in ('DUE','RECORDED')),
  expense_id uuid,
  created_at timestamptz not null default now(),
  recorded_at timestamptz,
  constraint recurring_expense_occurrences_scope_fk
    foreign key (business_id,shop_id)
    references public.business_shops(business_id,shop_id),
  constraint recurring_expense_occurrences_rule_fk
    foreign key (rule_id) references public.recurring_expense_rules(id) on delete restrict,
  constraint recurring_expense_occurrences_expense_fk
    foreign key (shop_id,expense_id) references public.expenses(shop_id,id),
  constraint recurring_expense_occurrences_unique_due unique (rule_id,due_on),
  constraint recurring_expense_occurrences_recorded_ck check(
    (status='DUE' and expense_id is null and recorded_at is null)
    or (status='RECORDED' and expense_id is not null and recorded_at is not null))
);
alter table public.recurring_expense_occurrences enable row level security;
revoke all on public.recurring_expense_occurrences from public,anon,authenticated;
grant select,insert,update on public.recurring_expense_occurrences to service_role;

-- Rule edits apply prospectively. A changed rule cannot rewrite already posted expenses.
create or replace function public.upsert_recurring_expense_rule_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_rule_id uuid,
 p_expected_version bigint,p_category_id uuid,p_description text,
 p_amount_minor bigint,p_cadence text,p_next_due_date date,
 p_active boolean,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
 v_business_id uuid;v_authorized boolean;
 v_rule public.recurring_expense_rules%rowtype;
 v_fingerprint text;v_existing private.finance_management_commands%rowtype;
 v_id uuid;v_version bigint;v_result jsonb;
begin
 select a.business_id,a.authorized into v_business_id,v_authorized
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.adjust') a;
 if not coalesce(v_authorized,false) or v_business_id is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 if p_expected_version is null or p_expected_version<0
   or nullif(btrim(p_description),'') is null or length(p_description)>500
   or p_amount_minor is null or p_amount_minor<=0
   or p_cadence not in ('DAILY','WEEKLY','MONTHLY')
   or p_next_due_date is null or p_active is null
   or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
   return jsonb_build_object('ok',false,'code','recurring_expense_invalid');
 end if;
 if p_category_id is not null and not exists(
   select 1 from public.expense_categories c
   where c.id=p_category_id and c.business_id=v_business_id and c.active
     and (c.shop_id=p_shop_id or c.shop_id is null)) then
   return jsonb_build_object('ok',false,'code','recurring_expense_category_forbidden');
 end if;
 v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
   'actor',p_actor_employee_id,'shop',p_shop_id,'rule',p_rule_id,
   'expectedVersion',p_expected_version,'category',p_category_id,
   'description',p_description,'amount',p_amount_minor,'cadence',p_cadence,
   'nextDue',p_next_due_date,'active',p_active)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(
   v_business_id::text||':p7-management:'||p_command_id,0));
 select * into v_existing from private.finance_management_commands
 where business_id=v_business_id and command_id=p_command_id;
 if found then
   if v_existing.request_fingerprint<>v_fingerprint then
     return jsonb_build_object('ok',false,'code','finance_command_conflict');
   end if;
   return v_existing.receipt||jsonb_build_object('replayed',true);
 end if;
 if p_rule_id is null then
   if p_expected_version<>0 then
     return jsonb_build_object('ok',false,'code','recurring_expense_version_conflict');
   end if;
   insert into public.recurring_expense_rules(
     business_id,shop_id,category_id,description,amount_minor,cadence,
     next_due_date,active,created_by_employee_id)
   values(v_business_id,p_shop_id,p_category_id,btrim(p_description),
     p_amount_minor,p_cadence,p_next_due_date,p_active,p_actor_employee_id)
   returning id,version into v_id,v_version;
 else
   select * into v_rule from public.recurring_expense_rules
   where id=p_rule_id and business_id=v_business_id and shop_id=p_shop_id for update;
   if not found then return jsonb_build_object('ok',false,'code','recurring_expense_not_found'); end if;
   if v_rule.version<>p_expected_version then
     return jsonb_build_object('ok',false,'code','recurring_expense_version_conflict');
   end if;
   update public.recurring_expense_rules set
     category_id=p_category_id,description=btrim(p_description),
     amount_minor=p_amount_minor,cadence=p_cadence,
     next_due_date=p_next_due_date,active=p_active,
     version=version+1,updated_at=now()
   where id=p_rule_id returning id,version into v_id,v_version;
 end if;
 perform public.append_admin_audit_event_v1(
   v_business_id,p_shop_id,p_actor_employee_id,
   'FINANCE_RECURRING_RULE_CHANGED','RECURRING_EXPENSE_RULE',v_id::text,
   null,jsonb_build_object('version',v_version,'amountMinor',p_amount_minor,
     'cadence',p_cadence,'nextDueDate',p_next_due_date,'active',p_active),
   'Recurring expense definition changed prospectively',null,null,'{}'::jsonb);
 v_result:=jsonb_build_object('ok',true,'ruleId',v_id,'version',v_version,'replayed',false);
 insert into private.finance_management_commands(business_id,command_id,
   request_fingerprint,receipt)
 values(v_business_id,p_command_id,v_fingerprint,v_result);
 return v_result;
end;
$$;

-- Service-only job, safe to call repeatedly. Generates DUE reminders, NOT
-- paid expenses or finance movements. Staff confirms the real expense.
create or replace function public.generate_due_recurring_expenses_v1(p_until date)
returns bigint language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
 v_rule public.recurring_expense_rules%rowtype;
 v_date date;
 v_count bigint:=0;
 v_step integer;
begin
 if p_until is null or p_until<(now() at time zone 'Africa/Cairo')::date
    or p_until>(now() at time zone 'Africa/Cairo')::date+31 then
   raise exception using errcode='22023',message='TUX_RECURRING_HORIZON_INVALID';
 end if;
 for v_rule in select * from public.recurring_expense_rules
   where active and next_due_date<=p_until
   order by business_id,shop_id,id for update skip locked
 loop
   v_date:=v_rule.next_due_date;
   v_step:=0;
   while v_date<=p_until loop
     insert into public.recurring_expense_occurrences(
       business_id,shop_id,rule_id,due_on,amount_minor,description_snapshot,category_id,rule_version)
     values(v_rule.business_id,v_rule.shop_id,v_rule.id,v_date,v_rule.amount_minor,v_rule.description,v_rule.category_id,v_rule.version)
     on conflict(rule_id,due_on) do nothing;
     if found then v_count:=v_count+1; end if;
     v_date:=case v_rule.cadence
       when 'DAILY' then v_date+1
       when 'WEEKLY' then v_date+7
       else (v_date+interval '1 month')::date end;
     v_step:=v_step+1;
     if v_step>100 then raise exception 'TUX_RECURRING_HORIZON_TOO_LARGE'; end if;
   end loop;
   update public.recurring_expense_rules set next_due_date=v_date,
     version=version+1,updated_at=now()
   where id=v_rule.id;
 end loop;
 return v_count;
end;
$$;

create or replace function public.finance_recurring_workspace_v1(
 p_actor_employee_id uuid,p_shop_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
 v_business_id uuid;v_authorized boolean;v_rules jsonb;v_due jsonb;
begin
 select a.business_id,a.authorized into v_business_id,v_authorized
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.view') a;
 if not coalesce(v_authorized,false) or v_business_id is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id,'categoryId',r.category_id,'description',r.description,
   'amountMinor',r.amount_minor,'cadence',r.cadence,
   'nextDueDate',r.next_due_date,'active',r.active,'version',r.version)
   order by r.description,r.id),'[]'::jsonb)
 into v_rules from public.recurring_expense_rules r
 where r.business_id=v_business_id and r.shop_id=p_shop_id;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',o.id,'ruleId',o.rule_id,'dueOn',o.due_on,'status',o.status,
   'description',o.description_snapshot,'amountMinor',o.amount_minor,
   'categoryId',o.category_id,'ruleVersion',o.rule_version)
   order by o.due_on,o.id),'[]'::jsonb)
 into v_due
 from public.recurring_expense_occurrences o
 join public.recurring_expense_rules r on r.id=o.rule_id
 where o.business_id=v_business_id and o.shop_id=p_shop_id
   and o.status='DUE' and o.due_on<=(now() at time zone 'Africa/Cairo')::date+31;
 return jsonb_build_object('ok',true,'rules',v_rules,'due',v_due);
end;
$$;


-- Consume a single DUE occurrence through the same canonical expense/finance RPC.
create or replace function public.post_recurring_expense_occurrence_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_occurrence_id uuid,
  p_business_day_id uuid,p_finance_account_id uuid,p_reason text,
  p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_business_id uuid;v_authorized boolean;
  v_occ public.recurring_expense_occurrences%rowtype;
  v_result jsonb;v_expense_id uuid;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.adjust') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  select * into v_occ from public.recurring_expense_occurrences
    where id=p_occurrence_id and business_id=v_business_id
      and shop_id=p_shop_id for update;
  if not found then return jsonb_build_object('ok',false,'code','recurring_due_not_found'); end if;
  if v_occ.status='RECORDED' then
    return jsonb_build_object('ok',false,'code','recurring_due_already_recorded');
  end if;
  v_result:=public.execute_finance_management_v1(
    p_actor_employee_id,p_shop_id,'EXPENSE',
    jsonb_build_object(
      'amountMinor',v_occ.amount_minor,
      'businessDayId',p_business_day_id,
      'fromAccountId',p_finance_account_id,
      'description',v_occ.description_snapshot,
      'categoryId',v_occ.category_id,
      'expenseDate',v_occ.due_on,
      'reason',p_reason,
      'recurringOccurrenceId',v_occ.id
    ),p_command_id);
  if v_result->>'ok'<>'true' then return v_result; end if;
  v_expense_id:=(v_result->>'expenseId')::uuid;
  update public.recurring_expense_occurrences
  set status='RECORDED',expense_id=v_expense_id,recorded_at=now()
  where id=v_occ.id;
  return v_result||jsonb_build_object('occurrenceId',v_occ.id);
end;
$$;
revoke all on function public.post_recurring_expense_occurrence_v1(uuid,uuid,uuid,uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.post_recurring_expense_occurrence_v1(uuid,uuid,uuid,uuid,uuid,text,text)
 to service_role;

revoke all on function public.finance_cashier_expectations_v1(uuid,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.upsert_recurring_expense_rule_v1(uuid,uuid,uuid,bigint,uuid,text,bigint,text,date,boolean,text)
  from public,anon,authenticated;
revoke all on function public.finance_recurring_workspace_v1(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.generate_due_recurring_expenses_v1(date)
  from public,anon,authenticated;
grant execute on function public.finance_cashier_expectations_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.upsert_recurring_expense_rule_v1(uuid,uuid,uuid,bigint,uuid,text,bigint,text,date,boolean,text) to service_role;
grant execute on function public.finance_recurring_workspace_v1(uuid,uuid) to service_role;
grant execute on function public.generate_due_recurring_expenses_v1(date) to service_role;
