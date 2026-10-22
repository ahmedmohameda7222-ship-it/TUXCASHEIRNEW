-- TUX Admin WhatsApp configuration and source-backed event delivery authority.
-- Repository migration only. Never apply remotely from automated implementation tooling.

alter table public.whatsapp_channels
  add constraint whatsapp_channels_shop_id_id_unique unique (shop_id, id);

create table public.whatsapp_admin_preferences (
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null,
  automation_enabled boolean not null default false,
  channel_configured boolean not null default false,
  webhook_health text not null default 'UNKNOWN'
    check (webhook_health in ('UNKNOWN', 'HEALTHY', 'STALE', 'ERROR')),
  last_webhook_at timestamptz,
  last_outbound_at timestamptz,
  last_error_code text check (last_error_code is null or btrim(last_error_code) <> ''),
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, shop_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create or replace function private.ensure_whatsapp_admin_preferences_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.whatsapp_admin_preferences(business_id, shop_id)
  values (new.business_id, new.shop_id)
  on conflict (business_id, shop_id) do nothing;
  return new;
end;
$$;

insert into public.whatsapp_admin_preferences(business_id, shop_id)
select business_id, shop_id from public.business_shops
on conflict (business_id, shop_id) do nothing;

create trigger business_shops_whatsapp_preferences_v1
after insert on public.business_shops
for each row execute function private.ensure_whatsapp_admin_preferences_v1();

create table public.whatsapp_admin_quick_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 1024),
  enabled boolean not null default true,
  sort_position integer not null default 0 check (sort_position >= 0),
  updated_by_employee_id uuid not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create index whatsapp_admin_quick_replies_scope_idx
  on public.whatsapp_admin_quick_replies(business_id, shop_id, enabled, sort_position, id);

create table public.whatsapp_event_message_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null,
  channel_id uuid not null,
  event_type text not null
    check (event_type in ('ORDER_ACCEPTED', 'DELIVERY_OUT_FOR_DELIVERY', 'DELIVERY_DELIVERED')),
  provider_template_id text not null check (char_length(btrim(provider_template_id)) between 1 and 255),
  language_code text not null check (language_code ~ '^[A-Za-z]{2,3}([_-][A-Za-z]{2})?$'),
  enabled boolean not null default false,
  unsupported_reason text check (unsupported_reason is null or btrim(unsupported_reason) <> ''),
  version bigint not null default 1 check (version > 0),
  updated_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, shop_id, id),
  unique (shop_id, event_type),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (shop_id, channel_id)
    references public.whatsapp_channels(shop_id, id) on delete restrict,
  foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  check (enabled = false or unsupported_reason is null)
);

create table public.whatsapp_event_send_intents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null,
  order_id uuid not null,
  source_event_id uuid not null,
  source_event_type text not null
    check (source_event_type in ('ORDER_ACCEPTED', 'DELIVERY_OUT_FOR_DELIVERY', 'DELIVERY_DELIVERED')),
  rule_id uuid not null,
  rule_version bigint not null check (rule_version > 0),
  intent_key text not null check (char_length(btrim(intent_key)) between 1 and 512),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'LEASED', 'SENT', 'FAILED', 'UNCERTAIN', 'CANCELLED')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_owner text check (lease_owner is null or btrim(lease_owner) <> ''),
  lease_token text check (lease_token is null or btrim(lease_token) <> ''),
  lease_until timestamptz,
  provider_message_id text check (provider_message_id is null or btrim(provider_message_id) <> ''),
  last_error_code text check (last_error_code is null or btrim(last_error_code) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, intent_key),
  unique (shop_id, id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (shop_id, order_id)
    references public.orders(shop_id, id) on delete restrict,
  foreign key (business_id, shop_id, rule_id)
    references public.whatsapp_event_message_rules(business_id, shop_id, id) on delete restrict,
  constraint whatsapp_event_send_intents_lease_shape_check check (
    (status = 'LEASED' and lease_owner is not null and lease_token is not null and lease_until is not null)
    or (status <> 'LEASED' and lease_owner is null and lease_token is null and lease_until is null)
  )
);

create index whatsapp_event_send_intents_due_idx
  on public.whatsapp_event_send_intents(status, created_at, id)
  where status in ('PENDING', 'LEASED');

create or replace function private.preserve_whatsapp_control_identity_v1()
returns trigger language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if to_jsonb(old) - array['enabled','sort_position','title','body','provider_template_id','language_code','unsupported_reason','version','updated_by_employee_id','updated_at']
     is distinct from
     to_jsonb(new) - array['enabled','sort_position','title','body','provider_template_id','language_code','unsupported_reason','version','updated_by_employee_id','updated_at'] then
    raise exception 'TUX_WHATSAPP_IMMUTABLE_IDENTITY';
  end if;
  return new;
end;
$$;

create trigger whatsapp_admin_quick_replies_identity_v1
before update on public.whatsapp_admin_quick_replies
for each row execute function private.preserve_whatsapp_control_identity_v1();
create trigger whatsapp_event_message_rules_identity_v1
before update on public.whatsapp_event_message_rules
for each row execute function private.preserve_whatsapp_control_identity_v1();

create or replace function public.enqueue_whatsapp_event_send_intent_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_order_id uuid,
  p_source_event_id uuid,
  p_source_event_type text,
  p_rule_id uuid
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule public.whatsapp_event_message_rules%rowtype;
  v_intent_id uuid;
  v_intent_key text;
begin
  select * into v_rule
  from public.whatsapp_event_message_rules
  where business_id = p_business_id and shop_id = p_shop_id and id = p_rule_id
    and enabled and event_type = p_source_event_type;
  if v_rule.id is null then raise exception 'TUX_WHATSAPP_RULE_NOT_ENABLED'; end if;

  if p_source_event_type <> 'ORDER_ACCEPTED' then
    raise exception 'TUX_WHATSAPP_EVENT_SOURCE_UNSUPPORTED';
  end if;
  if not exists (
    select 1 from public.online_order_requests request
    where request.id = p_source_event_id and request.shop_id = p_shop_id
      and request.status = 'ACCEPTED' and request.accepted_order_id = p_order_id
  ) then
    raise exception 'TUX_WHATSAPP_EVENT_SOURCE_INVALID';
  end if;

  v_intent_key := concat('whatsapp-event:v1:', p_shop_id, ':', p_source_event_type, ':', p_source_event_id, ':', p_rule_id, ':', v_rule.version);
  insert into public.whatsapp_event_send_intents(
    business_id, shop_id, order_id, source_event_id, source_event_type,
    rule_id, rule_version, intent_key
  ) values (
    p_business_id, p_shop_id, p_order_id, p_source_event_id, p_source_event_type,
    p_rule_id, v_rule.version, v_intent_key
  ) on conflict (business_id, intent_key) do nothing
  returning id into v_intent_id;

  if v_intent_id is null then
    select id into v_intent_id from public.whatsapp_event_send_intents
    where business_id = p_business_id and intent_key = v_intent_key;
  end if;
  return v_intent_id;
end;
$$;

create or replace function public.lease_whatsapp_event_send_intents_v1(
  p_lease_owner text,
  p_lease_token text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns setof public.whatsapp_event_send_intents
language sql security definer
set search_path = pg_catalog, public, private
as $$
  with due as (
    select intent.id
    from public.whatsapp_event_send_intents intent
    where intent.status = 'PENDING'
       or (intent.status = 'LEASED' and intent.lease_until < now())
    order by intent.created_at, intent.id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.whatsapp_event_send_intents intent
  set status = 'LEASED', attempts = intent.attempts + 1,
      lease_owner = btrim(p_lease_owner), lease_token = btrim(p_lease_token),
      lease_until = now() + make_interval(secs => greatest(5, least(p_lease_seconds, 900))),
      updated_at = now()
  from due where intent.id = due.id
    and btrim(coalesce(p_lease_owner, '')) <> ''
    and btrim(coalesce(p_lease_token, '')) <> ''
  returning intent.*
$$;

revoke all on function public.enqueue_whatsapp_event_send_intent_v1(uuid,uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp_event_send_intent_v1(uuid,uuid,uuid,uuid,text,uuid) to service_role;
revoke all on function public.lease_whatsapp_event_send_intents_v1(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.lease_whatsapp_event_send_intents_v1(text,text,integer,integer) to service_role;

alter table public.whatsapp_messages add column sender_kind text;
alter table public.whatsapp_messages add column system_event_intent_id uuid;
update public.whatsapp_messages set sender_kind = 'WORKER' where direction = 'OUTBOUND';

create or replace function private.default_whatsapp_worker_sender_v1()
returns trigger language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.direction = 'OUTBOUND' and new.sender_kind is null
     and new.sent_by_worker_id is not null and new.initiated_by_device_id is not null then
    new.sender_kind := 'WORKER';
  end if;
  return new;
end;
$$;
create trigger whatsapp_messages_default_worker_sender_v1
before insert on public.whatsapp_messages
for each row execute function private.default_whatsapp_worker_sender_v1();

alter table public.whatsapp_messages drop constraint whatsapp_messages_direction_audit_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_sender_authority_check check (
    (direction = 'INBOUND' and sender_kind is null and outbound_intent_key is null
      and sent_by_worker_id is null and initiated_by_device_id is null and initiated_at is null
      and system_event_intent_id is null)
    or
    (direction = 'OUTBOUND' and sender_kind = 'WORKER'
      and btrim(coalesce(outbound_intent_key, '')) <> ''
      and sent_by_worker_id is not null and initiated_by_device_id is not null
      and initiated_at is not null and system_event_intent_id is null)
    or
    (direction = 'OUTBOUND' and sender_kind = 'SYSTEM'
      and btrim(coalesce(outbound_intent_key, '')) <> ''
      and sent_by_worker_id is null and initiated_by_device_id is null
      and initiated_at is not null and system_event_intent_id is not null)
  ),
  add constraint whatsapp_messages_system_intent_same_shop_fk
    foreign key (shop_id, system_event_intent_id)
    references public.whatsapp_event_send_intents(shop_id, id) on delete restrict;
create unique index whatsapp_messages_system_intent_unique
  on public.whatsapp_messages(shop_id, system_event_intent_id)
  where system_event_intent_id is not null;

alter table public.whatsapp_admin_preferences enable row level security;
alter table public.whatsapp_admin_quick_replies enable row level security;
alter table public.whatsapp_event_message_rules enable row level security;
alter table public.whatsapp_event_send_intents enable row level security;
revoke all on table public.whatsapp_admin_preferences, public.whatsapp_admin_quick_replies,
  public.whatsapp_event_message_rules, public.whatsapp_event_send_intents
  from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_admin_preferences,
  public.whatsapp_admin_quick_replies, public.whatsapp_event_message_rules to service_role;
grant select on table public.whatsapp_event_send_intents to service_role;
