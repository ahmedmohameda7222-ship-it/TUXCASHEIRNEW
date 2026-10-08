-- Expense category vocabulary is configuration, never a fabricated financial fact.
insert into public.expense_categories(business_id,shop_id,name)
select b.id,null::uuid,category.name
from public.businesses b
cross join (values ('Rent'),('Salaries and Wages'),('Utilities'),
  ('Maintenance'),('Marketing'),('Delivery'),('Supplies'),('Other')) category(name)
on conflict on constraint expense_categories_scope_name_unique do nothing;

create or replace function public.create_expense_category_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_scope_shop_id uuid,
  p_name text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
 v_business_id uuid;v_authorized boolean;v_role text;
 v_fingerprint text;v_old private.finance_management_commands%rowtype;
 v_name text;v_category_id uuid;v_result jsonb;
begin
 select a.business_id,a.authorized,a.employee_role
 into v_business_id,v_authorized,v_role
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.adjust') a;
 if not coalesce(v_authorized,false) or v_business_id is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 if (p_scope_shop_id is null and v_role not in ('OWNER','ADMIN'))
   or (p_scope_shop_id is not null and p_scope_shop_id<>p_shop_id) then
   return jsonb_build_object('ok',false,'code','finance_scope_forbidden');
 end if;
 v_name:=nullif(btrim(p_name),'');
 if v_name is null or length(v_name)>100
    or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
   return jsonb_build_object('ok',false,'code','expense_category_invalid');
 end if;
 v_fingerprint:=encode(extensions.digest(convert_to(
   jsonb_build_object('actor',p_actor_employee_id,'shop',p_shop_id,
     'scope',p_scope_shop_id,'name',v_name)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(
   v_business_id::text||':p7-management:'||p_command_id,0));
 select * into v_old from private.finance_management_commands
 where business_id=v_business_id and command_id=p_command_id;
 if found then
   if v_old.request_fingerprint<>v_fingerprint then
     return jsonb_build_object('ok',false,'code','finance_command_conflict');
   end if;
   return v_old.receipt||jsonb_build_object('replayed',true);
 end if;
 insert into public.expense_categories(business_id,shop_id,name)
 values(v_business_id,p_scope_shop_id,v_name)
 on conflict (business_id,shop_id,name) do nothing
 returning id into v_category_id;
 if v_category_id is null then
   select id into v_category_id from public.expense_categories
   where business_id=v_business_id and shop_id is not distinct from p_scope_shop_id
     and name=v_name;
 end if;
 perform public.append_admin_audit_event_v1(
   v_business_id,p_shop_id,p_actor_employee_id,'FINANCE_CATEGORY_DEFINED',
   'EXPENSE_CATEGORY',v_category_id::text,null,
   jsonb_build_object('name',v_name,'scopeShopId',p_scope_shop_id),
   'Expense category defined',null,null,'{}'::jsonb);
 v_result:=jsonb_build_object('ok',true,'replayed',false,
   'categoryId',v_category_id,'name',v_name);
 insert into private.finance_management_commands(business_id,command_id,
   request_fingerprint,receipt)
 values(v_business_id,p_command_id,v_fingerprint,v_result);
 return v_result;
end;
$$;
revoke all on function public.create_expense_category_v1(uuid,uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.create_expense_category_v1(uuid,uuid,uuid,text,text)
 to service_role;
