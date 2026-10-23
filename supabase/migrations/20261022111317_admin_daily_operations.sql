-- Admin daily operations: shop-scoped checklist snapshots and append-only manager notes.
-- Repository migration only. Exercise against isolated local PostgreSQL before deployment.

create table public.admin_daily_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  kind text not null check (kind in ('OPEN','CLOSE')),
  title text not null check (btrim(title) <> '' and length(title) <= 160),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,shop_id,id),
  foreign key (business_id,shop_id) references public.business_shops(business_id,shop_id) on delete restrict,
  foreign key (business_id,created_by_employee_id) references public.business_employees(business_id,id) on delete restrict
);
create unique index admin_daily_checklist_active_kind_uq on public.admin_daily_checklist_templates(business_id,shop_id,kind) where active;

create table public.admin_daily_checklist_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  template_id uuid not null,
  position integer not null check (position >= 0),
  label text not null check (btrim(label) <> '' and length(label) <= 300),
  required boolean not null default true,
  active boolean not null default true,
  unique (business_id,shop_id,template_id,id),
  unique (template_id,position),
  foreign key (business_id,shop_id,template_id) references public.admin_daily_checklist_templates(business_id,shop_id,id) on delete cascade
);

create table public.admin_daily_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  business_day_id uuid not null,
  template_id uuid not null,
  kind text not null check (kind in ('OPEN','CLOSE')),
  template_version integer not null check (template_version > 0),
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_employee_id uuid not null,
  version integer not null default 1 check (version > 0),
  unique (business_id,shop_id,id),
  unique (business_id,shop_id,business_day_id,kind),
  foreign key (business_id,shop_id) references public.business_shops(business_id,shop_id) on delete restrict,
  foreign key (shop_id,business_day_id) references public.business_days(shop_id,id) on delete restrict,
  foreign key (business_id,shop_id,template_id) references public.admin_daily_checklist_templates(business_id,shop_id,id) on delete restrict,
  foreign key (business_id,actor_employee_id) references public.business_employees(business_id,id) on delete restrict
);

create table public.admin_daily_checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  run_id uuid not null,
  template_item_id uuid not null,
  position integer not null,
  label_snapshot text not null,
  required_snapshot boolean not null,
  done boolean not null,
  done_by_employee_id uuid,
  done_at timestamptz,
  unique (run_id,template_item_id),
  foreign key (business_id,shop_id,run_id) references public.admin_daily_checklist_runs(business_id,shop_id,id) on delete cascade,
  foreign key (business_id,done_by_employee_id) references public.business_employees(business_id,id) on delete restrict,
  check ((done and done_by_employee_id is not null and done_at is not null) or (not done and done_by_employee_id is null and done_at is null))
);

create table public.admin_manager_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  note text not null check (btrim(note) <> '' and length(note) <= 2000 and note !~ '[[:cntrl:]<>]'),
  author_employee_id uuid not null,
  created_at timestamptz not null default now(),
  correction_of_id uuid,
  unique (business_id,shop_id,id),
  foreign key (business_id,shop_id) references public.business_shops(business_id,shop_id) on delete restrict,
  foreign key (business_id,author_employee_id) references public.business_employees(business_id,id) on delete restrict,
  foreign key (business_id,shop_id,correction_of_id) references public.admin_manager_log(business_id,shop_id,id) on delete restrict
);
create index admin_manager_log_shop_recency_idx on public.admin_manager_log(business_id,shop_id,created_at desc,id desc);

create table private.admin_daily_operations_command_receipts (
  business_id uuid not null references public.businesses(id) on delete cascade,
  command_id text not null check (btrim(command_id) <> '' and length(command_id) <= 160),
  command_type text not null,
  request_fingerprint text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id,command_id)
);

alter table public.admin_daily_checklist_templates enable row level security;
alter table public.admin_daily_checklist_items enable row level security;
alter table public.admin_daily_checklist_runs enable row level security;
alter table public.admin_daily_checklist_run_items enable row level security;
alter table public.admin_manager_log enable row level security;
alter table private.admin_daily_operations_command_receipts enable row level security;

revoke all on public.admin_daily_checklist_templates,public.admin_daily_checklist_items,public.admin_daily_checklist_runs,public.admin_daily_checklist_run_items,public.admin_manager_log from public,anon,authenticated;
revoke all on private.admin_daily_operations_command_receipts from public,anon,authenticated,service_role;
grant select,insert,update on public.admin_daily_checklist_templates,public.admin_daily_checklist_items,public.admin_daily_checklist_runs,public.admin_daily_checklist_run_items to service_role;
grant select,insert on public.admin_manager_log to service_role;

create or replace function public.get_admin_daily_checklist_v1(p_actor_employee_id uuid,p_shop_id uuid,p_kind text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare v_business uuid; v_allowed boolean; v_template public.admin_daily_checklist_templates%rowtype; v_day public.business_days%rowtype; v_run public.admin_daily_checklist_runs%rowtype; v_items jsonb;
begin
  if p_kind not in ('OPEN','CLOSE') then return jsonb_build_object('error','invalid_kind'); end if;
  select a.business_id,a.authorized into v_business,v_allowed from public.resolve_admin_authorization_v1(p_actor_employee_id,p_shop_id,'devices.view') a;
  if not coalesce(v_allowed,false) then raise exception 'TUX_ADMIN_DAILY_FORBIDDEN'; end if;
  select * into v_day from public.business_days where shop_id=p_shop_id order by started_at desc limit 1;
  select * into v_template from public.admin_daily_checklist_templates where business_id=v_business and shop_id=p_shop_id and kind=p_kind and active order by version desc limit 1;
  if not found then return jsonb_build_object('shopId',p_shop_id,'businessDayId',v_day.id,'kind',p_kind,'configured',false,'templateId',null,'templateTitle',null,'templateVersion',null,'runId',null,'runVersion',null,'openedAt',null,'completedAt',null,'actorEmployeeId',null,'items','[]'::jsonb); end if;
  select * into v_run from public.admin_daily_checklist_runs where business_id=v_business and shop_id=p_shop_id and business_day_id=v_day.id and kind=p_kind;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'label',coalesce(ri.label_snapshot,i.label),'required',coalesce(ri.required_snapshot,i.required),'done',coalesce(ri.done,false),'doneByEmployeeId',ri.done_by_employee_id,'doneAt',ri.done_at) order by i.position),'[]'::jsonb) into v_items
  from public.admin_daily_checklist_items i left join public.admin_daily_checklist_run_items ri on ri.business_id=i.business_id and ri.shop_id=i.shop_id and ri.run_id=v_run.id and ri.template_item_id=i.id
  where i.business_id=v_business and i.shop_id=p_shop_id and i.template_id=v_template.id and i.active;
  return jsonb_build_object('shopId',p_shop_id,'businessDayId',v_day.id,'kind',p_kind,'configured',true,'templateId',v_template.id,'templateTitle',v_template.title,'templateVersion',v_template.version,'runId',v_run.id,'runVersion',v_run.version,'openedAt',v_run.opened_at,'completedAt',v_run.completed_at,'actorEmployeeId',v_run.actor_employee_id,'items',v_items);
end $$;
revoke all on function public.get_admin_daily_checklist_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_admin_daily_checklist_v1(uuid,uuid,text) to service_role;

create or replace function public.complete_admin_daily_checklist_v1(p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid,p_kind text,p_template_id uuid,p_expected_version integer,p_done_item_ids uuid[],p_command_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_business uuid; v_allowed boolean; v_template public.admin_daily_checklist_templates%rowtype; v_day public.business_days%rowtype; v_receipt private.admin_daily_operations_command_receipts%rowtype; v_fingerprint text; v_result jsonb; v_run_id uuid;
begin
  select a.business_id,a.authorized into v_business,v_allowed from public.resolve_admin_authorization_v1(p_actor_employee_id,p_shop_id,'devices.manage') a;
  if not coalesce(v_allowed,false) then return jsonb_build_object('ok',false,'code','permission_forbidden'); end if;
  if p_kind not in ('OPEN','CLOSE') or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then return jsonb_build_object('ok',false,'code','daily_checklist_invalid'); end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('shop',p_shop_id,'day',p_business_day_id,'kind',p_kind,'template',p_template_id,'version',p_expected_version,'done',p_done_item_ids)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_business::text||':daily:'||p_command_id,0));
  select * into v_receipt from private.admin_daily_operations_command_receipts where business_id=v_business and command_id=p_command_id;
  if found then
    if v_receipt.command_type<>'CHECKLIST_COMPLETE' or v_receipt.request_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
    return v_receipt.receipt||jsonb_build_object('replayed',true);
  end if;
  select * into v_day from public.business_days where id=p_business_day_id and shop_id=p_shop_id for update;
  if not found then return jsonb_build_object('ok',false,'code','business_day_required'); end if;
  select * into v_template from public.admin_daily_checklist_templates where id=p_template_id and business_id=v_business and shop_id=p_shop_id and kind=p_kind and active for update;
  if not found then return jsonb_build_object('ok',false,'code','checklist_template_missing'); end if;
  if v_template.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale_version'); end if;
  if exists(select 1 from public.admin_daily_checklist_items i where i.business_id=v_business and i.shop_id=p_shop_id and i.template_id=p_template_id and i.active and i.required and not (i.id=any(coalesce(p_done_item_ids,'{}'::uuid[])))) then return jsonb_build_object('ok',false,'code','required_items_missing'); end if;
  if exists(select 1 from public.admin_daily_checklist_runs r where r.business_id=v_business and r.shop_id=p_shop_id and r.business_day_id=p_business_day_id and r.kind=p_kind) then return jsonb_build_object('ok',false,'code','checklist_already_completed'); end if;
  insert into public.admin_daily_checklist_runs(business_id,shop_id,business_day_id,template_id,kind,template_version,completed_at,actor_employee_id) values(v_business,p_shop_id,p_business_day_id,p_template_id,p_kind,v_template.version,now(),p_actor_employee_id) returning id into v_run_id;
  insert into public.admin_daily_checklist_run_items(business_id,shop_id,run_id,template_item_id,position,label_snapshot,required_snapshot,done,done_by_employee_id,done_at)
  select v_business,p_shop_id,v_run_id,i.id,i.position,i.label,i.required,i.id=any(coalesce(p_done_item_ids,'{}'::uuid[])),case when i.id=any(coalesce(p_done_item_ids,'{}'::uuid[])) then p_actor_employee_id end,case when i.id=any(coalesce(p_done_item_ids,'{}'::uuid[])) then now() end from public.admin_daily_checklist_items i where i.business_id=v_business and i.shop_id=p_shop_id and i.template_id=p_template_id and i.active;
  v_result:=jsonb_build_object('ok',true,'replayed',false,'runId',v_run_id);
  insert into private.admin_daily_operations_command_receipts values(v_business,p_command_id,'CHECKLIST_COMPLETE',v_fingerprint,v_result,now());
  perform public.append_admin_audit_event_v1(v_business,p_shop_id,p_actor_employee_id,'DAILY_CHECKLIST_COMPLETED','DAILY_CHECKLIST_RUN',v_run_id::text,null,jsonb_build_object('kind',p_kind,'templateVersion',v_template.version),null,null,null,jsonb_build_object('commandId',p_command_id));
  return v_result;
end $$;
revoke all on function public.complete_admin_daily_checklist_v1(uuid,uuid,uuid,text,uuid,integer,uuid[],text) from public,anon,authenticated;
grant execute on function public.complete_admin_daily_checklist_v1(uuid,uuid,uuid,text,uuid,integer,uuid[],text) to service_role;

create or replace function public.get_admin_manager_log_v1(p_actor_employee_id uuid,p_shop_id uuid,p_cursor timestamptz,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare v_business uuid; v_allowed boolean; v_rows jsonb;
begin
  select a.business_id,a.authorized into v_business,v_allowed from public.resolve_admin_authorization_v1(p_actor_employee_id,p_shop_id,'devices.view') a;
  if not coalesce(v_allowed,false) then raise exception 'TUX_ADMIN_DAILY_FORBIDDEN'; end if;
  if p_limit not between 1 and 50 then raise exception 'TUX_ADMIN_DAILY_LIMIT'; end if;
  select coalesce(jsonb_agg(x.payload order by x.created_at desc,x.id desc),'[]'::jsonb) into v_rows from (select l.id,l.created_at,jsonb_build_object('id',l.id,'shopId',l.shop_id,'note',l.note,'authorEmployeeId',l.author_employee_id,'createdAt',l.created_at,'correctionOfId',l.correction_of_id) payload from public.admin_manager_log l where l.business_id=v_business and l.shop_id=p_shop_id and (p_cursor is null or l.created_at<p_cursor) order by l.created_at desc,l.id desc limit p_limit) x;
  return jsonb_build_object('rows',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then (v_rows->(p_limit-1)->>'createdAt') else null end);
end $$;
revoke all on function public.get_admin_manager_log_v1(uuid,uuid,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.get_admin_manager_log_v1(uuid,uuid,timestamptz,integer) to service_role;

create or replace function public.append_admin_manager_log_v1(p_actor_employee_id uuid,p_shop_id uuid,p_note text,p_correction_of_id uuid,p_command_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private,extensions as $$
declare v_business uuid; v_allowed boolean; v_receipt private.admin_daily_operations_command_receipts%rowtype; v_fingerprint text; v_result jsonb; v_id uuid;
begin
  select a.business_id,a.authorized into v_business,v_allowed from public.resolve_admin_authorization_v1(p_actor_employee_id,p_shop_id,'devices.manage') a;
  if not coalesce(v_allowed,false) then return jsonb_build_object('ok',false,'code','permission_forbidden'); end if;
  if nullif(btrim(p_note),'') is null or length(p_note)>2000 or p_note~'[[:cntrl:]<>]' or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then return jsonb_build_object('ok',false,'code','manager_note_invalid'); end if;
  if p_correction_of_id is not null and not exists(select 1 from public.admin_manager_log l where l.id=p_correction_of_id and l.business_id=v_business and l.shop_id=p_shop_id) then return jsonb_build_object('ok',false,'code','correction_target_missing'); end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object('shop',p_shop_id,'note',btrim(p_note),'correction',p_correction_of_id)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_business::text||':daily:'||p_command_id,0));
  select * into v_receipt from private.admin_daily_operations_command_receipts where business_id=v_business and command_id=p_command_id;
  if found then
    if v_receipt.command_type<>'MANAGER_NOTE_APPEND' or v_receipt.request_fingerprint<>v_fingerprint then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
    return v_receipt.receipt||jsonb_build_object('replayed',true);
  end if;
  insert into public.admin_manager_log(business_id,shop_id,note,author_employee_id,correction_of_id) values(v_business,p_shop_id,btrim(p_note),p_actor_employee_id,p_correction_of_id) returning id into v_id;
  v_result:=jsonb_build_object('ok',true,'replayed',false,'entryId',v_id);
  insert into private.admin_daily_operations_command_receipts values(v_business,p_command_id,'MANAGER_NOTE_APPEND',v_fingerprint,v_result,now());
  perform public.append_admin_audit_event_v1(v_business,p_shop_id,p_actor_employee_id,'MANAGER_LOG_APPENDED','MANAGER_LOG',v_id::text,null,jsonb_build_object('correctionOfId',p_correction_of_id),null,null,null,jsonb_build_object('commandId',p_command_id));
  return v_result;
end $$;
revoke all on function public.append_admin_manager_log_v1(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.append_admin_manager_log_v1(uuid,uuid,text,uuid,text) to service_role;
