-- Plan 7 saved views, targets and post-finalization owner summary.
alter table public.saved_report_views
  add column version bigint not null default 1 check (version>0);
alter table public.report_targets
  add column version bigint not null default 1 check (version>0);

create table private.admin_report_commands (
  business_id uuid not null references public.businesses(id),
  command_id text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  primary key(business_id,command_id)
);
revoke all on private.admin_report_commands from public,anon,authenticated;

create or replace function public.admin_report_config_query_v1(
 p_actor_employee_id uuid,p_shop_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
 v_business_id uuid; v_authorized boolean; v_role text;
 v_views jsonb; v_targets jsonb;
begin
 select a.business_id,a.authorized,a.employee_role
 into v_business_id,v_authorized,v_role
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'reports.view') a;
 if not coalesce(v_authorized,false) or v_business_id is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'reportArea',s.report_area,
    'shopId',s.shop_id,'filters',s.filters,'layout',s.layout,
    'version',s.version) order by s.name,s.id),'[]'::jsonb)
 into v_views from public.saved_report_views s
 where s.business_id=v_business_id and s.owner_employee_id=p_actor_employee_id
   and (s.shop_id=p_shop_id or s.shop_id is null);
 select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'shopId',t.shop_id,'metric',t.metric,
    'periodStart',t.period_start,'periodEnd',t.period_end,
    'targetValue',t.target_value,'version',t.version)
    order by t.period_start desc,t.id),'[]'::jsonb)
 into v_targets from public.report_targets t
 where t.business_id=v_business_id and t.shop_id=p_shop_id;
 return jsonb_build_object('ok',true,'savedViews',v_views,'targets',v_targets);
end;
$$;

create or replace function public.admin_report_config_command_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_action text,p_payload jsonb,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_business_id uuid; v_authorized boolean; v_role text;
  v_fingerprint text; v_old private.admin_report_commands%rowtype;
  v_view public.saved_report_views%rowtype;
  v_target public.report_targets%rowtype;
  v_id uuid; v_expected bigint;
  v_name text; v_area text; v_metric text;
  v_start date; v_end date; v_value bigint;
  v_result jsonb;
begin
  select a.business_id,a.authorized,a.employee_role
  into v_business_id,v_authorized,v_role
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,
    case when p_action='SET_TARGET' then 'settings.manage' else 'reports.view' end) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_action not in ('SAVE_VIEW','DELETE_VIEW','SET_TARGET')
     or p_payload is null or jsonb_typeof(p_payload)<>'object'
     or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','report_command_invalid');
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(
    jsonb_build_object('actor',p_actor_employee_id,'shop',p_shop_id,
       'action',p_action,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text||':report-command:'||p_command_id,0));
  select * into v_old from private.admin_report_commands
    where business_id=v_business_id and command_id=p_command_id;
  if found then
    if v_old.request_fingerprint<>v_fingerprint then
      return jsonb_build_object('ok',false,'code','report_command_conflict');
    end if;
    return v_old.result||jsonb_build_object('replayed',true);
  end if;
  begin
    v_id:=nullif(p_payload->>'id','')::uuid;
    v_expected:=(p_payload->>'expectedVersion')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'code','report_command_invalid');
  end;

  if p_action='SAVE_VIEW' then
    v_name:=nullif(btrim(p_payload->>'name'),'');
    v_area:=p_payload->>'reportArea';
    if v_name is null or length(v_name)>100
       or v_area not in ('sales','profit','products','inventory-consumption','waste',
         'theoretical-variance','margin-variance','purchasing','customers',
         'payments','expenses','staff','delivery','refunds','tax','end-day',
         'bank-cash','shop-comparison')
       or jsonb_typeof(p_payload->'filters')<>'object'
       or jsonb_typeof(p_payload->'layout')<>'object'
       or octet_length((p_payload->'filters')::text)>6000
       or octet_length((p_payload->'layout')::text)>6000 then
      return jsonb_build_object('ok',false,'code','report_view_invalid');
    end if;
    if v_id is null then
      if v_expected is distinct from 0 then
        return jsonb_build_object('ok',false,'code','report_view_version_conflict');
      end if;
      insert into public.saved_report_views(
        business_id,owner_employee_id,shop_id,name,report_area,filters,layout)
      values(v_business_id,p_actor_employee_id,p_shop_id,v_name,v_area,
        p_payload->'filters',p_payload->'layout') returning id into v_id;
      v_expected:=1;
    else
      select * into v_view from public.saved_report_views
        where id=v_id and business_id=v_business_id
        and owner_employee_id=p_actor_employee_id and shop_id=p_shop_id for update;
      if not found then
        return jsonb_build_object('ok',false,'code','report_view_not_found');
      end if;
      if v_view.version is distinct from v_expected then
        return jsonb_build_object('ok',false,'code','report_view_version_conflict');
      end if;
      update public.saved_report_views set name=v_name,report_area=v_area,
        filters=p_payload->'filters',layout=p_payload->'layout',
        version=version+1,updated_at=now()
      where id=v_id;
      v_expected:=v_expected+1;
    end if;
  elsif p_action='DELETE_VIEW' then
    select * into v_view from public.saved_report_views
      where id=v_id and business_id=v_business_id
      and owner_employee_id=p_actor_employee_id and shop_id=p_shop_id for update;
    if not found then return jsonb_build_object('ok',false,'code','report_view_not_found'); end if;
    if v_view.version is distinct from v_expected then
      return jsonb_build_object('ok',false,'code','report_view_version_conflict');
    end if;
    delete from public.saved_report_views where id=v_id;
  else
    v_metric:=p_payload->>'metric';
    begin
      v_start:=(p_payload->>'periodStart')::date;
      v_end:=(p_payload->>'periodEnd')::date;
      v_value:=(p_payload->>'targetValue')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('ok',false,'code','report_target_invalid');
    end;
    if v_metric not in ('NET_SALES','ORDER_COUNT','FOOD_COST_PERCENT','WASTE')
       or v_start is null or v_end is null or v_end<v_start
       or v_end-v_start>366 or v_value is null or v_value<0 then
      return jsonb_build_object('ok',false,'code','report_target_invalid');
    end if;
    select * into v_target from public.report_targets
      where business_id=v_business_id and shop_id=p_shop_id
      and metric=v_metric and period_start=v_start and period_end=v_end
      for update;
    if found then
      if v_target.version is distinct from v_expected then
        return jsonb_build_object('ok',false,'code','report_target_version_conflict');
      end if;
      update public.report_targets set target_value=v_value,
        updated_by_employee_id=p_actor_employee_id,updated_at=now(),version=version+1
      where id=v_target.id returning id into v_id;
      v_expected:=v_expected+1;
    else
      if v_expected is distinct from 0 then
        return jsonb_build_object('ok',false,'code','report_target_version_conflict');
      end if;
      insert into public.report_targets(business_id,shop_id,metric,
        period_start,period_end,target_value,updated_by_employee_id)
      values(v_business_id,p_shop_id,v_metric,v_start,v_end,v_value,p_actor_employee_id)
      returning id into v_id;
      v_expected:=1;
    end if;
  end if;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,
    p_actor_employee_id,'REPORT_'||p_action,'REPORT_CONFIGURATION',v_id::text,
    null,jsonb_build_object('version',v_expected,'action',p_action),
    'Report configuration updated',null,null,'{}'::jsonb);
  v_result:=jsonb_build_object('ok',true,'replayed',false,
    'id',v_id,'version',v_expected);
  insert into private.admin_report_commands(
    business_id,command_id,request_fingerprint,result)
  values(v_business_id,p_command_id,v_fingerprint,v_result);
  return v_result;
end;
$$;

create or replace function private.create_plan7_owner_summary_on_z_v1()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_stock_issues bigint;
  v_failed_online bigint;
  v_large_refunds bigint;
  v_approval_pending bigint;
  v_variances bigint;
  v_summary jsonb;
  v_hash text;
begin
  select count(*) into v_stock_issues
  from public.inventory_items i
  left join lateral (
    select coalesce(sum(m.quantity_delta_micros),0) on_hand
    from public.inventory_movements m
    where m.shop_id=i.shop_id and m.inventory_item_id=i.id
  ) stock on true
  where i.shop_id=new.shop_id and i.active
    and stock.on_hand<i.low_stock_threshold_micros;

  select count(*) into v_failed_online
  from public.online_order_requests r
  join public.business_days d on d.id=new.business_day_id and d.shop_id=new.shop_id
  where r.shop_id=new.shop_id and r.status in ('REJECTED','FAILED')
    and r.created_at>=d.started_at and r.created_at<d.ended_at;

  select count(*) into v_large_refunds
  from public.admin_order_refunds r
  join public.orders o on o.id=r.order_id and o.shop_id=r.shop_id
  where r.shop_id=new.shop_id and r.business_id=new.business_id
    and o.business_day_id=new.business_day_id and r.state='POSTED'
    and r.amount_minor>=100000;
  select count(*) into v_approval_pending
  from public.admin_approval_requests ar
  where ar.business_id=new.business_id and ar.shop_id=new.shop_id
    and ar.status='PENDING';
  select count(*) into v_variances
  from public.cashier_reconciliations c
  where c.business_id=new.business_id and c.shop_id=new.shop_id
    and c.business_day_id=new.business_day_id and c.variance_minor<>0;

  v_summary:=jsonb_build_object(
    'reportKind','DAILY_OWNER_SUMMARY',
    'businessDayId',new.business_day_id,'shopId',new.shop_id,
    'generatedFromSnapshotId',new.id,
    'netSalesMinor',new.snapshot->'netSalesMinor',
    'orderCount',new.snapshot->'orderCount',
    'estimatedOperatingProfitMinor',new.snapshot->'estimatedOperatingProfitMinor',
    'cashSalesNetMinor',new.snapshot->'cashSalesNetMinor',
    'cashVarianceCount',v_variances,
    'lowStockCount',v_stock_issues,
    'majorPostedRefundCount',v_large_refunds,
    'failedOnlineOrderCount',v_failed_online,
    'pendingApprovalCount',v_approval_pending,
    'wasteCostMinor',new.snapshot->'wasteCostMinor',
    'sections',jsonb_build_array('Sales','Profit','Cash','Inventory','Refunds','Operations'),
    'snapshotFinalizedAt',new.finalized_at
  );
  v_hash:=encode(extensions.digest(convert_to(v_summary::text,'UTF8'),'sha256'),'hex');
  insert into public.daily_owner_summaries(
    business_id,shop_id,business_day_id,summary,source_fingerprint)
  values(new.business_id,new.shop_id,new.business_day_id,v_summary,v_hash);
  return new;
end;
$$;

create trigger plan7_daily_owner_summary_after_z
after insert on public.end_day_financial_snapshots for each row
execute function private.create_plan7_owner_summary_on_z_v1();

revoke all on function private.create_plan7_owner_summary_on_z_v1() from public,anon,authenticated;
revoke all on function public.admin_report_config_query_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_report_config_command_v1(uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.admin_report_config_query_v1(uuid,uuid) to service_role;
grant execute on function public.admin_report_config_command_v1(uuid,uuid,text,jsonb,text)
  to service_role;
