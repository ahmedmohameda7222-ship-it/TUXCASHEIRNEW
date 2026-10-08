-- Plan 7 free-tier recurring fallback: bounded per-shop materialization, never auto-post payments.
create function public.process_due_recurring_expenses_v2(
 p_actor_employee_id uuid,p_shop_id uuid,p_until date,p_max_rules integer
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
 v_business uuid;v_allowed boolean;v_rule public.recurring_expense_rules%rowtype;
 v_date date;v_steps integer;v_generated bigint:=0;v_processed integer:=0;
begin
 select a.business_id,a.authorized into v_business,v_allowed
 from public.resolve_admin_authorization_v1(
  p_actor_employee_id,p_shop_id,'finance.adjust') a;
 if not coalesce(v_allowed,false) or v_business is null then
  return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 if p_until is distinct from (now() at time zone 'Africa/Cairo')::date
   or p_max_rules not between 1 and 25 or p_max_rules is null then
  return jsonb_build_object('ok',false,'code','recurring_horizon_invalid');
 end if;
 for v_rule in
  select * from public.recurring_expense_rules
  where business_id=v_business and shop_id=p_shop_id
   and active and next_due_date<=p_until
  order by next_due_date,id limit p_max_rules for update skip locked
 loop
  v_date:=v_rule.next_due_date;v_steps:=0;
  while v_date<=p_until and v_steps<25 loop
   insert into public.recurring_expense_occurrences(
    business_id,shop_id,rule_id,due_on,amount_minor,
    description_snapshot,category_id,rule_version)
   values(v_rule.business_id,v_rule.shop_id,v_rule.id,v_date,
    v_rule.amount_minor,v_rule.description,v_rule.category_id,v_rule.version)
   on conflict(rule_id,due_on) do nothing;
   if found then v_generated:=v_generated+1;end if;
   v_date:=case v_rule.cadence when 'DAILY' then v_date+1
    when 'WEEKLY' then v_date+7
    else (v_date+interval '1 month')::date end;
   v_steps:=v_steps+1;
  end loop;
  update public.recurring_expense_rules set next_due_date=v_date,
    version=version+1,updated_at=now() where id=v_rule.id;
  v_processed:=v_processed+1;
 end loop;
 return jsonb_build_object('ok',true,'rulesProcessed',v_processed,
   'dueOccurrencesGenerated',v_generated);
end;
$$;
revoke all on function public.process_due_recurring_expenses_v2(uuid,uuid,date,integer)
 from public,anon,authenticated;
grant execute on function public.process_due_recurring_expenses_v2(uuid,uuid,date,integer)
 to service_role;
