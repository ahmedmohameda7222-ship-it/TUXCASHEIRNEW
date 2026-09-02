-- TUX Operations WhatsApp inbox persistence.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.
-- Provider credentials are intentionally absent; all provider integration stays behind server boundaries.

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  normalized_phone text not null check (normalized_phone ~ '^01[0125][0-9]{8}$'),
  display_phone text not null check (display_phone ~ '^[+]201[0125][0-9]{8}$'),
  customer_contact_id uuid,
  customer_name text,
  context text not null default 'DIRECT'
    check (context in ('DIRECT', 'WEB_REQUEST', 'ORDER_LINKED')),
  unread_count integer not null default 0 check (unread_count >= 0),
  archived boolean not null default false,
  follow_up boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, normalized_phone),
  unique (shop_id, id),
  constraint whatsapp_conversations_customer_same_shop_fk
    foreign key (shop_id, customer_contact_id)
      references public.customer_contacts(shop_id, id)
);

create index whatsapp_conversations_shop_recency_idx
  on public.whatsapp_conversations (shop_id, archived, last_message_at desc nulls last);
create index whatsapp_conversations_customer_idx
  on public.whatsapp_conversations (shop_id, customer_contact_id)
  where customer_contact_id is not null;

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  conversation_id uuid not null,
  provider_message_id text,
  outbound_intent_key text,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  kind text not null check (kind in ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION', 'SYSTEM')),
  text text,
  media_ref text,
  media_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(media_metadata) = 'object'),
  status text not null check (status in ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  sent_by_worker_id uuid,
  initiated_by_device_id uuid,
  initiated_at timestamptz,
  provider_occurred_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  constraint whatsapp_messages_conversation_same_shop_fk
    foreign key (shop_id, conversation_id)
      references public.whatsapp_conversations(shop_id, id) on delete cascade,
  constraint whatsapp_messages_worker_same_shop_fk
    foreign key (shop_id, sent_by_worker_id)
      references public.workers(shop_id, id),
  constraint whatsapp_messages_device_same_shop_fk
    foreign key (shop_id, initiated_by_device_id)
      references public.devices(shop_id, id),
  constraint whatsapp_messages_direction_audit_check
    check (
      (
        direction = 'INBOUND'
        and outbound_intent_key is null
        and sent_by_worker_id is null
        and initiated_by_device_id is null
        and initiated_at is null
      )
      or
      (
        direction = 'OUTBOUND'
        and btrim(coalesce(outbound_intent_key, '')) <> ''
        and sent_by_worker_id is not null
        and initiated_by_device_id is not null
        and initiated_at is not null
      )
    ),
  constraint whatsapp_messages_provider_id_shape_check
    check (provider_message_id is null or btrim(provider_message_id) <> ''),
  constraint whatsapp_messages_content_shape_check
    check (
      (kind = 'TEXT' and btrim(coalesce(text, '')) <> '' and media_ref is null)
      or (kind in ('IMAGE', 'DOCUMENT', 'AUDIO') and btrim(coalesce(media_ref, '')) <> '')
      or (kind = 'LOCATION' and media_metadata <> '{}'::jsonb)
      or (kind = 'SYSTEM' and btrim(coalesce(text, '')) <> '')
    )
);

create unique index whatsapp_messages_provider_message_unique
  on public.whatsapp_messages (shop_id, provider_message_id)
  where provider_message_id is not null;

create unique index whatsapp_messages_outbound_intent_unique
  on public.whatsapp_messages (shop_id, outbound_intent_key)
  where outbound_intent_key is not null;

create index whatsapp_messages_conversation_created_idx
  on public.whatsapp_messages (shop_id, conversation_id, created_at, id);
create index whatsapp_messages_status_idx
  on public.whatsapp_messages (shop_id, status, updated_at);

create table public.whatsapp_quick_replies (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  category text not null
    check (category in ('PREPARATION', 'DELIVERY', 'ADDRESS', 'PAYMENT', 'DELAY', 'THANKS')),
  language text not null check (language in ('ar-EG', 'en')),
  text text not null check (btrim(text) <> ''),
  usage_count bigint not null default 0 check (usage_count >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id),
  unique (shop_id, category, language, text)
);

create index whatsapp_quick_replies_shop_active_idx
  on public.whatsapp_quick_replies (shop_id, active, language, category, usage_count desc);

create table public.whatsapp_conversation_order_links (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  conversation_id uuid not null,
  order_id uuid not null,
  linked_by_worker_id uuid not null,
  initiated_by_device_id uuid not null,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, id),
  unique (shop_id, conversation_id, order_id),
  constraint whatsapp_order_links_conversation_same_shop_fk
    foreign key (shop_id, conversation_id)
      references public.whatsapp_conversations(shop_id, id) on delete cascade,
  constraint whatsapp_order_links_order_same_shop_fk
    foreign key (shop_id, order_id)
      references public.orders(shop_id, id),
  constraint whatsapp_order_links_worker_same_shop_fk
    foreign key (shop_id, linked_by_worker_id)
      references public.workers(shop_id, id),
  constraint whatsapp_order_links_device_same_shop_fk
    foreign key (shop_id, initiated_by_device_id)
      references public.devices(shop_id, id),
  check (unlinked_at is null or unlinked_at >= linked_at)
);

create index whatsapp_order_links_conversation_active_idx
  on public.whatsapp_conversation_order_links (shop_id, conversation_id, linked_at desc)
  where unlinked_at is null;
create index whatsapp_order_links_order_active_idx
  on public.whatsapp_conversation_order_links (shop_id, order_id, linked_at desc)
  where unlinked_at is null;

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_quick_replies enable row level security;
alter table public.whatsapp_conversation_order_links enable row level security;

-- The server gateway owns all direct access in v1. RLS therefore has no client policies,
-- and table privileges are explicitly removed from browser/device roles.
revoke all on table public.whatsapp_conversations from public, anon, authenticated;
revoke all on table public.whatsapp_messages from public, anon, authenticated;
revoke all on table public.whatsapp_quick_replies from public, anon, authenticated;
revoke all on table public.whatsapp_conversation_order_links from public, anon, authenticated;

create or replace function public.materialize_tux_whatsapp_inbound_v1(
  p_shop_id uuid,
  p_provider_message_id text,
  p_normalized_phone text,
  p_display_phone text,
  p_kind text,
  p_text text default null,
  p_media_ref text default null,
  p_media_metadata jsonb default '{}'::jsonb,
  p_provider_occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_customer_contact_id uuid;
  v_customer_name text;
  v_message_created_at timestamptz := coalesce(p_provider_occurred_at, now());
begin
  if p_shop_id is null or not exists (
    select 1 from public.shops shop where shop.id = p_shop_id and shop.active
  ) then
    raise exception 'TUX_WHATSAPP_SHOP_INVALID';
  end if;
  if p_normalized_phone !~ '^01[0125][0-9]{8}$'
     or p_display_phone !~ '^[+]201[0125][0-9]{8}$' then
    raise exception 'TUX_WHATSAPP_PHONE_INVALID';
  end if;
  if btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception 'TUX_WHATSAPP_PROVIDER_MESSAGE_ID_INVALID';
  end if;
  if p_kind not in ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION') then
    raise exception 'TUX_WHATSAPP_MESSAGE_KIND_INVALID';
  end if;

  select customer.id, customer.name
    into v_customer_contact_id, v_customer_name
  from public.customer_contacts customer
  where customer.shop_id = p_shop_id
    and customer.normalized_phone = p_normalized_phone;

  insert into public.whatsapp_conversations as conversation (
    shop_id,
    normalized_phone,
    display_phone,
    customer_contact_id,
    customer_name,
    last_message_at,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    p_normalized_phone,
    p_display_phone,
    v_customer_contact_id,
    v_customer_name,
    v_message_created_at,
    now(),
    now()
  )
  on conflict (shop_id, normalized_phone)
  do update set
    display_phone = excluded.display_phone,
    customer_contact_id = excluded.customer_contact_id,
    customer_name = excluded.customer_name,
    updated_at = now()
  returning conversation.id into v_conversation_id;

  insert into public.whatsapp_messages as message (
    shop_id,
    conversation_id,
    provider_message_id,
    outbound_intent_key,
    direction,
    kind,
    text,
    media_ref,
    media_metadata,
    status,
    sent_by_worker_id,
    initiated_by_device_id,
    initiated_at,
    provider_occurred_at,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    v_conversation_id,
    p_provider_message_id,
    null,
    'INBOUND',
    p_kind,
    p_text,
    p_media_ref,
    coalesce(p_media_metadata, '{}'::jsonb),
    'DELIVERED',
    null,
    null,
    null,
    p_provider_occurred_at,
    v_message_created_at,
    now()
  )
  on conflict (shop_id, provider_message_id)
    where provider_message_id is not null
  do nothing
  returning message.id into v_message_id;

  if v_message_id is null then
    select message.id into v_message_id
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.provider_message_id = p_provider_message_id;
    return v_message_id;
  end if;

  update public.whatsapp_conversations conversation
     set unread_count = conversation.unread_count + 1,
         archived = false,
         last_message_at = greatest(
           coalesce(conversation.last_message_at, v_message_created_at),
           v_message_created_at
         ),
         updated_at = now()
   where conversation.shop_id = p_shop_id
     and conversation.id = v_conversation_id;

  return v_message_id;
end;
$$;

revoke all on function public.materialize_tux_whatsapp_inbound_v1(
  uuid, text, text, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_tux_whatsapp_inbound_v1(
  uuid, text, text, text, text, text, text, jsonb, timestamptz
) to service_role;

create or replace function public.create_tux_whatsapp_outbound_intent_v1(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_outbound_intent_key text,
  p_kind text,
  p_text text,
  p_media_ref text,
  p_media_metadata jsonb,
  p_sent_by_worker_id uuid,
  p_initiated_by_device_id uuid,
  p_initiated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_message_id uuid;
begin
  if btrim(coalesce(p_outbound_intent_key, '')) = '' then
    raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_INVALID';
  end if;
  if p_kind not in ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION') then
    raise exception 'TUX_WHATSAPP_MESSAGE_KIND_INVALID';
  end if;
  if p_initiated_at is null then
    raise exception 'TUX_WHATSAPP_INITIATED_AT_REQUIRED';
  end if;
  if not exists (
    select 1 from public.whatsapp_conversations conversation
    where conversation.shop_id = p_shop_id and conversation.id = p_conversation_id
  ) then
    raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
  end if;
  if not exists (
    select 1 from public.workers worker
    where worker.shop_id = p_shop_id and worker.id = p_sent_by_worker_id and worker.active
  ) then
    raise exception 'TUX_WHATSAPP_WORKER_INVALID';
  end if;
  if not exists (
    select 1 from public.devices device
    where device.shop_id = p_shop_id and device.id = p_initiated_by_device_id and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  insert into public.whatsapp_messages as message (
    shop_id,
    conversation_id,
    provider_message_id,
    outbound_intent_key,
    direction,
    kind,
    text,
    media_ref,
    media_metadata,
    status,
    sent_by_worker_id,
    initiated_by_device_id,
    initiated_at,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    p_conversation_id,
    null,
    p_outbound_intent_key,
    'OUTBOUND',
    p_kind,
    p_text,
    p_media_ref,
    coalesce(p_media_metadata, '{}'::jsonb),
    'PENDING',
    p_sent_by_worker_id,
    p_initiated_by_device_id,
    p_initiated_at,
    now(),
    now()
  )
  on conflict (shop_id, outbound_intent_key)
    where outbound_intent_key is not null
  do nothing
  returning message.id into v_message_id;

  if v_message_id is null then
    select message.id into v_message_id
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.outbound_intent_key = p_outbound_intent_key;
  end if;

  return v_message_id;
end;
$$;

revoke all on function public.create_tux_whatsapp_outbound_intent_v1(
  uuid, uuid, text, text, text, text, jsonb, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_tux_whatsapp_outbound_intent_v1(
  uuid, uuid, text, text, text, text, jsonb, uuid, uuid, timestamptz
) to service_role;

create or replace function public.attach_tux_whatsapp_provider_message_v1(
  p_shop_id uuid,
  p_message_id uuid,
  p_provider_message_id text,
  p_status text default 'SENT'
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception 'TUX_WHATSAPP_PROVIDER_MESSAGE_ID_INVALID';
  end if;
  if p_status not in ('SENT', 'DELIVERED', 'READ', 'FAILED') then
    raise exception 'TUX_WHATSAPP_MESSAGE_STATUS_INVALID';
  end if;

  update public.whatsapp_messages message
     set provider_message_id = p_provider_message_id,
         status = p_status,
         updated_at = now()
   where message.shop_id = p_shop_id
     and message.id = p_message_id
     and message.direction = 'OUTBOUND';

  if not found then
    raise exception 'TUX_WHATSAPP_OUTBOUND_MESSAGE_INVALID';
  end if;
end;
$$;

revoke all on function public.attach_tux_whatsapp_provider_message_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_tux_whatsapp_provider_message_v1(uuid, uuid, text, text)
  to service_role;

create or replace function public.update_tux_whatsapp_message_status_v1(
  p_shop_id uuid,
  p_provider_message_id text,
  p_status text,
  p_failure_code text default null,
  p_failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_current_status text;
  v_current_rank integer;
  v_incoming_rank integer;
begin
  if p_status not in ('SENT', 'DELIVERED', 'READ', 'FAILED') then
    raise exception 'TUX_WHATSAPP_MESSAGE_STATUS_INVALID';
  end if;

  select message.status
    into v_current_status
  from public.whatsapp_messages message
  where message.shop_id = p_shop_id
    and message.provider_message_id = p_provider_message_id
  for update;

  if not found then
    raise exception 'TUX_WHATSAPP_PROVIDER_MESSAGE_NOT_FOUND';
  end if;

  if v_current_status = 'FAILED' then
    return;
  end if;

  if p_status = 'FAILED' then
    update public.whatsapp_messages message
       set status = 'FAILED',
           failure_code = nullif(btrim(p_failure_code), ''),
           failure_message = nullif(btrim(p_failure_message), ''),
           updated_at = now()
     where message.shop_id = p_shop_id
       and message.provider_message_id = p_provider_message_id;
    return;
  end if;

  v_current_rank := case v_current_status
    when 'PENDING' then 0
    when 'SENT' then 1
    when 'DELIVERED' then 2
    when 'READ' then 3
    else -1
  end;
  v_incoming_rank := case p_status
    when 'SENT' then 1
    when 'DELIVERED' then 2
    when 'READ' then 3
    else -1
  end;

  if v_incoming_rank < v_current_rank then
    return;
  end if;

  update public.whatsapp_messages message
     set status = p_status,
         failure_code = null,
         failure_message = null,
         updated_at = now()
   where message.shop_id = p_shop_id
     and message.provider_message_id = p_provider_message_id;
end;
$$;

revoke all on function public.update_tux_whatsapp_message_status_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_tux_whatsapp_message_status_v1(
  uuid, text, text, text, text
) to service_role;

create or replace function public.get_tux_whatsapp_inbox_v1(
  p_shop_id uuid,
  p_after timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'conversations', coalesce((
      select jsonb_agg(to_jsonb(conversation) order by conversation.last_message_at desc nulls last, conversation.id)
      from public.whatsapp_conversations conversation
      where conversation.shop_id = p_shop_id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(message) order by message.created_at, message.id)
      from public.whatsapp_messages message
      where message.shop_id = p_shop_id
        and (p_after is null or message.updated_at > p_after)
    ), '[]'::jsonb),
    'quickReplies', coalesce((
      select jsonb_agg(to_jsonb(reply) order by reply.language, reply.category, reply.usage_count desc, reply.id)
      from public.whatsapp_quick_replies reply
      where reply.shop_id = p_shop_id and reply.active
    ), '[]'::jsonb),
    'orderLinks', coalesce((
      select jsonb_agg(to_jsonb(link) order by link.linked_at, link.id)
      from public.whatsapp_conversation_order_links link
      where link.shop_id = p_shop_id and link.unlinked_at is null
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_tux_whatsapp_inbox_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_inbox_v1(uuid, timestamptz)
  to service_role;

create or replace function public.set_tux_whatsapp_conversation_state_v1(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_archived boolean default null,
  p_follow_up boolean default null,
  p_mark_unread boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.whatsapp_conversations conversation
     set archived = coalesce(p_archived, conversation.archived),
         follow_up = coalesce(p_follow_up, conversation.follow_up),
         unread_count = case
           when p_mark_unread then greatest(conversation.unread_count, 1)
           else conversation.unread_count
         end,
         updated_at = now()
   where conversation.shop_id = p_shop_id
     and conversation.id = p_conversation_id;

  if not found then
    raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
  end if;
end;
$$;

revoke all on function public.set_tux_whatsapp_conversation_state_v1(
  uuid, uuid, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.set_tux_whatsapp_conversation_state_v1(
  uuid, uuid, boolean, boolean, boolean
) to service_role;

create or replace function public.link_tux_whatsapp_conversation_order_v1(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_order_id uuid,
  p_worker_id uuid,
  p_device_id uuid,
  p_linked boolean default true
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1 from public.whatsapp_conversations conversation
    where conversation.shop_id = p_shop_id and conversation.id = p_conversation_id
  ) then
    raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
  end if;
  if not exists (
    select 1 from public.orders tux_order
    where tux_order.shop_id = p_shop_id and tux_order.id = p_order_id
  ) then
    raise exception 'TUX_WHATSAPP_ORDER_INVALID';
  end if;
  if not exists (
    select 1 from public.workers worker
    where worker.shop_id = p_shop_id and worker.id = p_worker_id and worker.active
  ) then
    raise exception 'TUX_WHATSAPP_WORKER_INVALID';
  end if;
  if not exists (
    select 1 from public.devices device
    where device.shop_id = p_shop_id and device.id = p_device_id and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  if p_linked then
    insert into public.whatsapp_conversation_order_links as link (
      shop_id,
      conversation_id,
      order_id,
      linked_by_worker_id,
      initiated_by_device_id,
      linked_at,
      unlinked_at,
      created_at
    ) values (
      p_shop_id,
      p_conversation_id,
      p_order_id,
      p_worker_id,
      p_device_id,
      now(),
      null,
      now()
    )
    on conflict (shop_id, conversation_id, order_id)
    do update set
      linked_by_worker_id = excluded.linked_by_worker_id,
      initiated_by_device_id = excluded.initiated_by_device_id,
      linked_at = now(),
      unlinked_at = null;

    update public.whatsapp_conversations conversation
       set context = 'ORDER_LINKED', updated_at = now()
     where conversation.shop_id = p_shop_id and conversation.id = p_conversation_id;
  else
    update public.whatsapp_conversation_order_links link
       set unlinked_at = now()
     where link.shop_id = p_shop_id
       and link.conversation_id = p_conversation_id
       and link.order_id = p_order_id
       and link.unlinked_at is null;
  end if;
end;
$$;

revoke all on function public.link_tux_whatsapp_conversation_order_v1(
  uuid, uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.link_tux_whatsapp_conversation_order_v1(
  uuid, uuid, uuid, uuid, uuid, boolean
) to service_role;
