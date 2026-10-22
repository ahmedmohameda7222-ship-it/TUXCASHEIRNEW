-- Safe server-only WhatsApp event dispatch. Repository migration only.
-- Do not apply to a remote project from automated implementation tooling.

alter table public.whatsapp_event_send_intents
  add column provider_attempted_at timestamptz;

create table public.whatsapp_contact_messaging_consents (
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null,
  normalized_phone text not null check (normalized_phone ~ '^01[0125][0-9]{8}$'),
  opted_in boolean not null default false,
  consent_source text not null check (btrim(consent_source) <> ''),
  consented_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, shop_id, normalized_phone),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  check (
    (opted_in and consented_at is not null and revoked_at is null)
    or (not opted_in)
  )
);

create table public.whatsapp_event_intent_audit (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  shop_id uuid not null,
  intent_id uuid not null,
  from_status text,
  to_status text not null,
  error_code text,
  dispatch_owner text,
  created_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (shop_id, intent_id)
    references public.whatsapp_event_send_intents(shop_id, id) on delete restrict
);

create index whatsapp_event_intent_audit_intent_idx
  on public.whatsapp_event_intent_audit(shop_id, intent_id, created_at, id);

create or replace function private.prevent_whatsapp_event_audit_mutation_v1()
returns trigger language plpgsql
set search_path = pg_catalog, public, private
as $$ begin raise exception 'TUX_WHATSAPP_EVENT_AUDIT_APPEND_ONLY'; end; $$;

create trigger whatsapp_event_intent_audit_append_only_v1
before update or delete on public.whatsapp_event_intent_audit
for each row execute function private.prevent_whatsapp_event_audit_mutation_v1();

alter table public.whatsapp_contact_messaging_consents enable row level security;
alter table public.whatsapp_event_intent_audit enable row level security;
revoke all on table public.whatsapp_contact_messaging_consents, public.whatsapp_event_intent_audit
  from public, anon, authenticated, service_role;

create or replace function private.emit_whatsapp_order_accepted_intent_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare v_rule record;
begin
  if new.status <> 'ACCEPTED' or new.accepted_order_id is null
     or (tg_op = 'UPDATE' and old.status = 'ACCEPTED') then
    return new;
  end if;
  for v_rule in
    select bs.business_id, rule.id, rule.version
    from public.business_shops bs
    join public.whatsapp_admin_preferences pref
      on pref.business_id=bs.business_id and pref.shop_id=bs.shop_id
     and pref.automation_enabled
    join public.whatsapp_event_message_rules rule
      on rule.business_id=bs.business_id and rule.shop_id=bs.shop_id
     and rule.event_type='ORDER_ACCEPTED' and rule.enabled
    where bs.shop_id=new.shop_id
  loop
    insert into public.whatsapp_event_send_intents(
      business_id,shop_id,order_id,source_event_id,source_event_type,
      rule_id,rule_version,intent_key
    ) values (
      v_rule.business_id,new.shop_id,new.accepted_order_id,new.id,'ORDER_ACCEPTED',
      v_rule.id,v_rule.version,
      concat('whatsapp-event:v1:',new.shop_id,':ORDER_ACCEPTED:',new.id,':',v_rule.id,':',v_rule.version)
    ) on conflict (business_id,intent_key) do nothing;
  end loop;
  return new;
end;
$$;

create trigger online_order_requests_emit_whatsapp_accepted_v1
after insert or update of status, accepted_order_id on public.online_order_requests
for each row execute function private.emit_whatsapp_order_accepted_intent_v1();

create or replace function public.lease_whatsapp_event_send_intents_v2(
  p_lease_owner text,
  p_lease_token text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns table(intent_id uuid, lease_token text)
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  if btrim(coalesce(p_lease_owner,''))='' or btrim(coalesce(p_lease_token,''))='' then
    raise exception 'TUX_WHATSAPP_LEASE_IDENTITY_INVALID';
  end if;

  with expired as (
    update public.whatsapp_event_send_intents intent
       set status='UNCERTAIN', lease_owner=null, lease_token=null, lease_until=null,
           last_error_code='PROVIDER_OUTCOME_UNKNOWN', updated_at=now()
     where intent.status='LEASED' and intent.lease_until < now()
       and intent.provider_attempted_at is not null
     returning intent.business_id,intent.shop_id,intent.id,intent.lease_owner
  )
  insert into public.whatsapp_event_intent_audit(
    business_id,shop_id,intent_id,from_status,to_status,error_code,dispatch_owner
  ) select business_id,shop_id,id,'LEASED','UNCERTAIN','PROVIDER_OUTCOME_UNKNOWN',lease_owner from expired;

  return query
  with due as (
    select intent.id
    from public.whatsapp_event_send_intents intent
    where intent.status='PENDING'
       or (intent.status='LEASED' and intent.lease_until < now() and intent.provider_attempted_at is null)
    order by intent.created_at,intent.id
    for update skip locked
    limit greatest(1,least(p_limit,100))
  ), claimed as (
    update public.whatsapp_event_send_intents intent
       set status='LEASED',attempts=intent.attempts+1,
           lease_owner=btrim(p_lease_owner),lease_token=btrim(p_lease_token),
           lease_until=now()+make_interval(secs=>greatest(5,least(p_lease_seconds,900))),
           updated_at=now()
      from due where intent.id=due.id
      returning intent.business_id,intent.shop_id,intent.id,intent.lease_token,intent.lease_owner
  ), audited as (
    insert into public.whatsapp_event_intent_audit as audit(
      business_id,shop_id,intent_id,from_status,to_status,dispatch_owner
    ) select business_id,shop_id,id,null,'LEASED',lease_owner from claimed
    returning audit.intent_id as audited_intent_id
  )
  select claimed.id,claimed.lease_token from claimed join audited on audited.audited_intent_id=claimed.id;
end;
$$;

create or replace function public.begin_whatsapp_event_provider_attempt_v1(
  p_intent_id uuid,
  p_lease_token text
)
returns table(
  intent_id uuid,message_id uuid,shop_id uuid,provider_phone_number_id text,
  recipient_normalized_phone text,provider_template_name text,language_code text,variables jsonb
)
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_intent public.whatsapp_event_send_intents%rowtype;
  v_rule public.whatsapp_event_message_rules%rowtype;
  v_channel public.whatsapp_channels%rowtype;
  v_template public.whatsapp_starter_templates%rowtype;
  v_request public.online_order_requests%rowtype;
  v_order public.orders%rowtype;
  v_shop public.shops%rowtype;
  v_message_id uuid;
  v_conversation_id uuid;
  v_outbound_key text;
  v_variables jsonb;
  v_location text;
  v_error text;
begin
  select * into v_intent from public.whatsapp_event_send_intents intent
   where intent.id=p_intent_id and intent.status='LEASED'
     and intent.lease_token=btrim(p_lease_token) and intent.lease_until>=now()
     and intent.provider_attempted_at is null for update;
  if v_intent.id is null then return; end if;

  if not exists(select 1 from public.whatsapp_admin_preferences pref
    where pref.business_id=v_intent.business_id and pref.shop_id=v_intent.shop_id and pref.automation_enabled)
  then v_error:='AUTOMATION_DISABLED'; end if;

  if v_error is null then
    select * into v_rule from public.whatsapp_event_message_rules rule
     where rule.business_id=v_intent.business_id and rule.shop_id=v_intent.shop_id
       and rule.id=v_intent.rule_id and rule.version=v_intent.rule_version
       and rule.enabled and rule.event_type=v_intent.source_event_type;
    if v_rule.id is null then v_error:='RULE_DISABLED_OR_CHANGED'; end if;
  end if;

  if v_error is null then
    select * into v_channel from public.whatsapp_channels channel
     where channel.shop_id=v_intent.shop_id and channel.id=v_rule.channel_id and channel.active;
    if v_channel.id is null then v_error:='NO_ACTIVE_CHANNEL'; end if;
  end if;

  if v_error is null then
    select * into v_template from public.whatsapp_starter_templates template
     where template.shop_id=v_intent.shop_id and template.channel_id=v_channel.id
       and template.provider_template_name=v_rule.provider_template_id
       and template.language_code=v_rule.language_code
       and template.active and template.provider_status='APPROVED';
    if v_template.id is null then v_error:='TEMPLATE_NOT_APPROVED'; end if;
  end if;

  if v_error is null then
    select * into v_request from public.online_order_requests request
     where request.id=v_intent.source_event_id and request.shop_id=v_intent.shop_id
       and request.status='ACCEPTED' and request.accepted_order_id=v_intent.order_id;
    select * into v_order from public.orders orders
     where orders.id=v_intent.order_id and orders.shop_id=v_intent.shop_id and orders.source='ONLINE';
    if v_request.id is null or v_order.id is null or v_intent.source_event_type<>'ORDER_ACCEPTED'
    then v_error:='CANONICAL_SOURCE_INVALID'; end if;
  end if;

  if v_error is null and (v_request.normalized_phone is null or v_request.normalized_phone !~ '^01[0125][0-9]{8}$')
  then v_error:='RECIPIENT_INELIGIBLE'; end if;
  if v_error is null and not exists(
    select 1 from public.whatsapp_contact_messaging_consents consent
     where consent.business_id=v_intent.business_id and consent.shop_id=v_intent.shop_id
       and consent.normalized_phone=v_request.normalized_phone and consent.opted_in
       and consent.consented_at is not null and consent.revoked_at is null
  ) then v_error:='RECIPIENT_NOT_OPTED_IN'; end if;

  if v_error is not null then
    update public.whatsapp_event_send_intents set status='CANCELLED',last_error_code=v_error,
      lease_owner=null,lease_token=null,lease_until=null,updated_at=now() where id=v_intent.id;
    insert into public.whatsapp_event_intent_audit(
      business_id,shop_id,intent_id,from_status,to_status,error_code,dispatch_owner
    ) values(v_intent.business_id,v_intent.shop_id,v_intent.id,'LEASED','CANCELLED',v_error,v_intent.lease_owner);
    return;
  end if;

  select * into v_shop from public.shops shop where shop.id=v_intent.shop_id and shop.active;
  if v_shop.id is null then
    update public.whatsapp_event_send_intents set status='CANCELLED',last_error_code='SHOP_INACTIVE',
      lease_owner=null,lease_token=null,lease_until=null,updated_at=now() where id=v_intent.id;
    insert into public.whatsapp_event_intent_audit(business_id,shop_id,intent_id,from_status,to_status,error_code,dispatch_owner)
      values(v_intent.business_id,v_intent.shop_id,v_intent.id,'LEASED','CANCELLED','SHOP_INACTIVE',v_intent.lease_owner);
    return;
  end if;

  select coalesce(
    (select nullif(btrim(config.store_location_label),'')
       from public.whatsapp_shop_messaging_config config where config.shop_id=v_shop.id),
    nullif(btrim(v_shop.address_text),'')
  ) into v_location;
  v_variables:=jsonb_build_array(
    left(split_part(btrim(v_request.customer_name),' ',1),80),
    v_order.display_order_no::text,'ACCEPTED',left(v_shop.name,120)
  );
  if v_location is not null then v_variables:=v_variables||jsonb_build_array(left(v_location,160)); end if;

  insert into public.whatsapp_conversations as conversation(
    shop_id,normalized_phone,display_phone,customer_contact_id,customer_name,context,created_at,updated_at
  ) values(
    v_intent.shop_id,v_request.normalized_phone,'+2'||v_request.normalized_phone,
    v_order.customer_contact_id,v_request.customer_name,'ORDER_LINKED',now(),now()
  ) on conflict on constraint whatsapp_conversations_shop_id_normalized_phone_key do update set
    display_phone=excluded.display_phone,
    customer_contact_id=coalesce(conversation.customer_contact_id,excluded.customer_contact_id),
    customer_name=coalesce(conversation.customer_name,excluded.customer_name),
    updated_at=now()
  returning conversation.id into v_conversation_id;

  v_outbound_key:=encode(extensions.digest(
    'tux-auto-v1|'||v_intent.source_event_id||'|'||v_intent.rule_id||'|'||v_intent.rule_version,'sha256'
  ),'hex');
  insert into public.whatsapp_messages as message(
    shop_id,conversation_id,outbound_intent_key,direction,kind,text,media_metadata,status,
    sender_kind,system_event_intent_id,initiated_at,created_at,updated_at
  ) values(
    v_intent.shop_id,v_conversation_id,v_outbound_key,'OUTBOUND','SYSTEM',v_template.preview_text,
    jsonb_build_object('templateVariables',v_variables),'PENDING','SYSTEM',v_intent.id,now(),now(),now()
  ) on conflict do nothing
  returning message.id into v_message_id;
  if v_message_id is null then
    select message.id into v_message_id from public.whatsapp_messages message
     where message.shop_id=v_intent.shop_id and message.outbound_intent_key=v_outbound_key
       and message.system_event_intent_id=v_intent.id and message.status='PENDING'
       and message.provider_message_id is null;
  end if;
  if v_message_id is null then
    update public.whatsapp_event_send_intents set status='UNCERTAIN',last_error_code='SYSTEM_MESSAGE_CONFLICT',
      lease_owner=null,lease_token=null,lease_until=null,updated_at=now() where id=v_intent.id;
    insert into public.whatsapp_event_intent_audit(business_id,shop_id,intent_id,from_status,to_status,error_code,dispatch_owner)
      values(v_intent.business_id,v_intent.shop_id,v_intent.id,'LEASED','UNCERTAIN','SYSTEM_MESSAGE_CONFLICT',v_intent.lease_owner);
    return;
  end if;

  update public.whatsapp_event_send_intents set provider_attempted_at=now(),updated_at=now()
   where id=v_intent.id and lease_token=btrim(p_lease_token);
  insert into public.whatsapp_event_intent_audit(business_id,shop_id,intent_id,from_status,to_status,dispatch_owner)
    values(v_intent.business_id,v_intent.shop_id,v_intent.id,'LEASED','PROVIDER_ATTEMPTED',v_intent.lease_owner);
  return query select v_intent.id,v_message_id,v_intent.shop_id,v_channel.provider_phone_number_id,
    v_request.normalized_phone,v_template.provider_template_name,v_template.language_code,v_variables;
end;
$$;

create or replace function public.complete_whatsapp_event_provider_attempt_v1(
  p_intent_id uuid,p_lease_token text,p_outcome text,p_provider_message_id text,p_error_code text
)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_intent public.whatsapp_event_send_intents%rowtype; v_message_id uuid;
begin
  if p_outcome not in ('SENT','FAILED','UNCERTAIN') then raise exception 'TUX_WHATSAPP_OUTCOME_INVALID'; end if;
  select * into v_intent from public.whatsapp_event_send_intents intent
   where intent.id=p_intent_id and intent.status='LEASED'
     and intent.lease_token=btrim(p_lease_token) and intent.provider_attempted_at is not null for update;
  if v_intent.id is null then raise exception 'TUX_WHATSAPP_EVENT_LEASE_INVALID'; end if;
  select message.id into v_message_id from public.whatsapp_messages message
   where message.shop_id=v_intent.shop_id and message.system_event_intent_id=v_intent.id for update;
  if v_message_id is null then raise exception 'TUX_WHATSAPP_SYSTEM_MESSAGE_MISSING'; end if;

  if p_outcome='SENT' then
    if btrim(coalesce(p_provider_message_id,''))='' then raise exception 'TUX_WHATSAPP_PROVIDER_MESSAGE_ID_INVALID'; end if;
    update public.whatsapp_messages set provider_message_id=btrim(p_provider_message_id),status='SENT',
      failure_code=null,failure_message=null,updated_at=now() where id=v_message_id;
  elsif p_outcome='FAILED' then
    update public.whatsapp_messages set status='FAILED',failure_code=nullif(btrim(p_error_code),''),
      failure_message='WhatsApp provider rejected the automatic template.',updated_at=now() where id=v_message_id;
  end if;
  update public.whatsapp_event_send_intents set status=p_outcome,provider_message_id=nullif(btrim(p_provider_message_id),''),
    last_error_code=nullif(btrim(p_error_code),''),lease_owner=null,lease_token=null,lease_until=null,updated_at=now()
   where id=v_intent.id;
  update public.whatsapp_admin_preferences set
    last_outbound_at=case when p_outcome='SENT' then now() else last_outbound_at end,
    last_error_code=case when p_outcome='SENT' then null else nullif(btrim(p_error_code),'') end,
    updated_at=now()
   where business_id=v_intent.business_id and shop_id=v_intent.shop_id;
  insert into public.whatsapp_event_intent_audit(business_id,shop_id,intent_id,from_status,to_status,error_code,dispatch_owner)
    values(v_intent.business_id,v_intent.shop_id,v_intent.id,'PROVIDER_ATTEMPTED',p_outcome,nullif(btrim(p_error_code),''),v_intent.lease_owner);
end;
$$;

-- Delivery callbacks are monotonic: a late FAILED/SENT callback cannot move a
-- confirmed SENT/DELIVERED/READ message backwards.
create or replace function public.update_tux_whatsapp_message_status_v1(
  p_shop_id uuid,p_provider_message_id text,p_status text,
  p_failure_code text default null,p_failure_message text default null
)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare v_current_status text; v_current_rank integer; v_incoming_rank integer;
begin
  if p_status not in ('SENT','DELIVERED','READ','FAILED') then raise exception 'TUX_WHATSAPP_MESSAGE_STATUS_INVALID'; end if;
  select message.status into v_current_status from public.whatsapp_messages message
   where message.shop_id=p_shop_id and message.provider_message_id=p_provider_message_id for update;
  if not found then raise exception 'TUX_WHATSAPP_PROVIDER_MESSAGE_NOT_FOUND'; end if;
  if v_current_status='FAILED' or (p_status='FAILED' and v_current_status<>'PENDING') then return; end if;
  if p_status='FAILED' then
    update public.whatsapp_messages set status='FAILED',failure_code=nullif(btrim(p_failure_code),''),
      failure_message=nullif(btrim(p_failure_message),''),updated_at=now()
     where shop_id=p_shop_id and provider_message_id=p_provider_message_id;
    return;
  end if;
  v_current_rank:=case v_current_status when 'PENDING' then 0 when 'SENT' then 1 when 'DELIVERED' then 2 when 'READ' then 3 else -1 end;
  v_incoming_rank:=case p_status when 'SENT' then 1 when 'DELIVERED' then 2 when 'READ' then 3 else -1 end;
  if v_incoming_rank<v_current_rank then return; end if;
  update public.whatsapp_messages set status=p_status,failure_code=null,failure_message=null,updated_at=now()
   where shop_id=p_shop_id and provider_message_id=p_provider_message_id;
end;
$$;

revoke all on function public.lease_whatsapp_event_send_intents_v2(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.begin_whatsapp_event_provider_attempt_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.complete_whatsapp_event_provider_attempt_v1(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.lease_whatsapp_event_send_intents_v2(text,text,integer,integer) to service_role;
grant execute on function public.begin_whatsapp_event_provider_attempt_v1(uuid,text) to service_role;
grant execute on function public.complete_whatsapp_event_provider_attempt_v1(uuid,text,text,text,text) to service_role;
revoke execute on function public.lease_whatsapp_event_send_intents_v1(text,text,integer,integer) from service_role;
