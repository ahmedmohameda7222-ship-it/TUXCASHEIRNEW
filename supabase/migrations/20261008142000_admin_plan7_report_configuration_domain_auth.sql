-- Plan 7 defense in depth: saved views and report targets cannot bypass domain grants.
alter function public.admin_report_config_command_v1(uuid,uuid,text,jsonb,text)
  rename to admin_report_config_command_base_v1;

create or replace function public.admin_report_config_query_v1(
 p_actor_employee_id uuid,p_shop_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_business uuid;v_allowed boolean;v_views jsonb;v_targets jsonb;
begin
 select a.business_id,a.authorized into v_business,v_allowed
 from public.resolve_admin_authorization_v1(
 p_actor_employee_id,p_shop_id,'reports.view') a;
 if not coalesce(v_allowed,false) or v_business is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'reportArea',s.report_area,
  'shopId',s.shop_id,'filters',s.filters,'layout',s.layout,
  'version',s.version) order by s.name,s.id),'[]'::jsonb)
 into v_views from public.saved_report_views s
 where s.business_id=v_business and s.owner_employee_id=p_actor_employee_id
  and (s.shop_id=p_shop_id or s.shop_id is null)
  and private.plan7_report_required_permission_v1(s.report_area) is not null
  and exists(select 1 from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,
    private.plan7_report_required_permission_v1(s.report_area)) a
    where a.authorized)
  and private.plan7_report_context_allowed_v1(p_actor_employee_id,p_shop_id,
    coalesce(s.filters->'context',s.filters,'{}'::jsonb));
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'shopId',t.shop_id,'metric',t.metric,
  'periodStart',t.period_start,'periodEnd',t.period_end,
  'targetValue',t.target_value,'version',t.version)
  order by t.period_start desc,t.id),'[]'::jsonb)
 into v_targets from public.report_targets t
 where t.business_id=v_business and t.shop_id=p_shop_id
  and exists(select 1 from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,
    case t.metric
      when 'FOOD_COST_PERCENT' then 'finance.view'
      when 'WASTE' then 'inventory.view'
      else 'reports.view' end
   ) a where a.authorized);
 return jsonb_build_object('ok',true,'savedViews',v_views,'targets',v_targets);
end;
$$;

create function public.admin_report_config_command_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_action text,
 p_payload jsonb,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_required text;v_authorized boolean;
begin
 if p_action='SAVE_VIEW' then
   v_required:=private.plan7_report_required_permission_v1(
     p_payload->>'reportArea');
   if v_required is null then
     return jsonb_build_object('ok',false,'code','report_area_invalid');
   end if;
 elsif p_action='SET_TARGET' then
   v_required:=case p_payload->>'metric'
     when 'FOOD_COST_PERCENT' then 'finance.view'
     when 'WASTE' then 'inventory.view'
     else 'reports.view' end;
 end if;
 if v_required is not null then
   select a.authorized into v_authorized
   from public.resolve_admin_authorization_v1(
     p_actor_employee_id,p_shop_id,v_required) a;
   if not coalesce(v_authorized,false) then
     return jsonb_build_object('ok',false,'code','permission_forbidden');
   end if;
 end if;
 if p_action='SAVE_VIEW' and not private.plan7_report_context_allowed_v1(
   p_actor_employee_id,p_shop_id,
   coalesce(p_payload->'filters'->'context',p_payload->'filters','{}'::jsonb)) then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 return public.admin_report_config_command_base_v1(
   p_actor_employee_id,p_shop_id,p_action,p_payload,p_command_id);
end;
$$;
revoke all on function public.admin_report_config_query_v1(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.admin_report_config_command_v1(uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.admin_report_config_query_v1(uuid,uuid) to service_role;
grant execute on function public.admin_report_config_command_v1(uuid,uuid,text,jsonb,text)
  to service_role;
