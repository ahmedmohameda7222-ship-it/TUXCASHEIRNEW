
insert into auth.users(id) values ('54000000-0000-4000-8000-000000000001');
insert into public.shops(id,name) values ('52000000-0000-4000-8000-000000000001','Test shop');
insert into public.workers(id,shop_id,display_name,pin_hash)
 values ('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','Worker','hash');
insert into public.shop_memberships(id,shop_id,auth_user_id,role)
 values (gen_random_uuid(),'52000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','OPERATIONS_DEVICE');
insert into public.devices(id,shop_id,label,auth_user_id)
 values ('55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','Browser','54000000-0000-4000-8000-000000000001');
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id)
 values ('56000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','OPEN','2026-10-10T09:00:00Z','53000000-0000-4000-8000-000000000001');

create function pg_temp.test_rpc(p_event uuid,p_type text,p_day uuid,p_table text,p_row jsonb,p_mode text default 'UPSERT')
returns text language plpgsql as $body$
declare s uuid:='52000000-0000-4000-8000-000000000001'; env jsonb; plan jsonb;
begin
 env:=jsonb_build_object('eventId',p_event,'shopId',s,'businessDayId',p_day,
   'aggregateType','TEST','aggregateId',p_day,'eventType',p_type,'idempotencyKey',p_event::text,
   'payloadVersion',1,'payload',jsonb_build_object('eventType',p_type),'createdAt','2026-10-10T09:00:00Z');
 plan:=jsonb_build_object('eventId',p_event,'shopId',s,'eventType',p_type,'idempotencyKey',p_event::text,
   'mutations',jsonb_build_array(jsonb_build_object('table',p_table,'mode',p_mode,
     'conflictColumns',jsonb_build_array('id'),'row',p_row,'guard',
     case when p_mode='UPDATE' then '{"kind":"STATE_RANK","column":"status","incomingStatus":"CLOSED","rank":{"OPEN":0,"CLOSED":1}}'::jsonb else null end)));
 return public.ingest_tux_operations_materialization_v1(
  '54000000-0000-4000-8000-000000000001'::uuid,
  '55000000-0000-4000-8000-000000000001'::uuid,env,repeat('a',64),plan);
end $body$;

do $body$
declare s uuid:='52000000-0000-4000-8000-000000000001';
 w uuid:='53000000-0000-4000-8000-000000000001';
 d1 uuid:='56000000-0000-4000-8000-000000000001';
 d2 uuid:='56000000-0000-4000-8000-000000000002';
 row jsonb; err text;
begin
 row:=jsonb_build_object('id',d2,'shop_id',s,'status','OPEN',
    'started_at','2026-10-11T09:00:00Z','started_by_worker_id',w,
    'ended_at',null,'ended_by_worker_id',null,'last_allocated_display_order_no',0);
 begin
  perform pg_temp.test_rpc('60000000-0000-4000-8000-000000000001','BUSINESS_DAY_STARTED',d2,'business_days',row);
  raise exception 'Expected two OPEN days conflict';
 exception when others then
  get stacked diagnostics err=MESSAGE_TEXT;
  if err not like 'TUX_BUSINESS_DAY_OPEN_CONFLICT:%' then
    raise exception 'Expected typed OPEN conflict, got %',err;
  end if;
 end;
 row:=jsonb_build_object('id','59000000-0000-4000-8000-000000000001',
  'shop_id',s,'business_day_id',d2,'worker_id',w,'started_at','2026-10-11T09:02:00Z','ended_at',null);
 begin
  perform pg_temp.test_rpc('60000000-0000-4000-8000-000000000002','WORKER_SIGNED_IN',d2,'worker_sessions',row);
  raise exception 'Expected missing business-day dependency';
 exception when others then
  get stacked diagnostics err=MESSAGE_TEXT;
  if err not like 'TUX_BUSINESS_DAY_DEPENDENCY_MISSING:%' then
    raise exception 'Expected typed business-day FK dependency, got %',err;
  end if;
 end;
 if (select count(*) from public.business_days where shop_id=s and status='OPEN')<>1
   or (select count(*) from public.worker_sessions)<>0
   or (select count(*) from public.operations_sync_event_receipts)<>0 then
   raise exception 'Failed event wrote partial mutations or receipts';
 end if;
 raise notice 'PASS: real materialization RPC typed day conflicts and atomic rollback';
end $body$;
