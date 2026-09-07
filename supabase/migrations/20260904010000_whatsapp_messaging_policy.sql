-- TUX Operations WhatsApp messaging-window, starter-template, and storefront policy.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.

create table public.whatsapp_shop_messaging_config (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  storefront_url text not null
    check (storefront_url ~ '^https://[^[:space:]]+$'),
  store_latitude double precision,
  store_longitude double precision,
  store_location_label text,
  store_location_address text,
  updated_at timestamptz not null default now(),
  constraint whatsapp_shop_messaging_config_location_pair_check
    check (
      (store_latitude is null and store_longitude is null)
      or (
        store_latitude between -90 and 90
        and store_longitude between -180 and 180
      )
    )
);

alter table public.whatsapp_shop_messaging_config enable row level security;
revoke all on table public.whatsapp_shop_messaging_config from public, anon, authenticated;

create table public.whatsapp_starter_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  channel_id uuid not null references public.whatsapp_channels(id) on delete cascade,
  display_label text not null check (btrim(display_label) <> ''),
  provider_template_name text not null check (btrim(provider_template_name) <> ''),
  language_code text not null check (btrim(language_code) <> ''),
  preview_text text not null check (btrim(preview_text) <> ''),
  provider_status text not null check (provider_status = 'APPROVED'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index whatsapp_starter_templates_one_active_logical
  on public.whatsapp_starter_templates (
    channel_id,
    provider_template_name,
    language_code
  )
  where active = true;

create index whatsapp_starter_templates_shop_active_idx
  on public.whatsapp_starter_templates (shop_id, active, display_label, id);

alter table public.whatsapp_starter_templates enable row level security;
revoke all on table public.whatsapp_starter_templates from public, anon, authenticated;

create or replace function public.get_tux_whatsapp_messaging_policy_v1(
  p_shop_id uuid,
  p_conversation_id uuid
)
returns table(
  conversation_id uuid,
  normalized_phone text,
  display_phone text,
  last_inbound_at timestamptz,
  free_form_until timestamptz,
  storefront_url text,
  store_latitude double precision,
  store_longitude double precision,
  store_location_label text,
  store_location_address text,
  templates_json jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_config public.whatsapp_shop_messaging_config%rowtype;
  v_last_inbound_at timestamptz;
  v_templates jsonb;
begin
  if p_conversation_id is not null then
    select conversation.*
      into v_conversation
    from public.whatsapp_conversations conversation
    where conversation.shop_id = p_shop_id
      and conversation.id = p_conversation_id;

    if v_conversation.id is null then
      raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
    end if;
  end if;

  select config.*
    into v_config
  from public.whatsapp_shop_messaging_config config
  where config.shop_id = p_shop_id;

  if v_config.shop_id is null then
    raise exception 'TUX_WHATSAPP_MESSAGING_CONFIG_MISSING';
  end if;

  select max(coalesce(message.provider_occurred_at, message.created_at))
    into v_last_inbound_at
  from public.whatsapp_messages message
  where message.shop_id = p_shop_id
    and message.conversation_id = p_conversation_id
    and message.direction = 'INBOUND';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', template.id,
        'label', template.display_label,
        'languageCode', template.language_code,
        'previewText', template.preview_text
      )
      order by template.display_label, template.id
    ),
    '[]'::jsonb
  )
    into v_templates
  from public.whatsapp_starter_templates template
  join public.whatsapp_channels channel
    on channel.id = template.channel_id
   and channel.shop_id = p_shop_id
   and channel.active
  where template.shop_id = p_shop_id
    and template.active
    and template.provider_status = 'APPROVED';

  return query
  select
    v_conversation.id,
    v_conversation.normalized_phone,
    v_conversation.display_phone,
    v_last_inbound_at,
    case
      when v_last_inbound_at is null then null
      else v_last_inbound_at + interval '24 hours'
    end,
    v_config.storefront_url,
    v_config.store_latitude,
    v_config.store_longitude,
    v_config.store_location_label,
    v_config.store_location_address,
    v_templates;
end;
$$;

revoke all on function public.get_tux_whatsapp_messaging_policy_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_messaging_policy_v1(uuid, uuid)
  to service_role;

create or replace function public.get_tux_whatsapp_contact_target_v1(
  p_shop_id uuid,
  p_normalized_phone text
)
returns table(
  conversation_id uuid,
  normalized_phone text,
  display_phone text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select conversation.id, conversation.normalized_phone, conversation.display_phone
  from public.whatsapp_conversations conversation
  where conversation.shop_id = p_shop_id
    and conversation.normalized_phone = p_normalized_phone
  limit 1
$$;

revoke all on function public.get_tux_whatsapp_contact_target_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_contact_target_v1(uuid, text)
  to service_role;

create or replace function public.claim_tux_whatsapp_template_intent_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_normalized_phone text,
  p_display_phone text,
  p_outbound_intent_key text,
  p_template_id uuid,
  p_initiated_at timestamptz
)
returns table(
  created boolean,
  recipient_normalized_phone text,
  provider_template_name text,
  language_code text,
  message_json jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
  v_template public.whatsapp_starter_templates%rowtype;
  v_conversation_id uuid;
  v_message_id uuid;
  v_created boolean := false;
  v_message public.whatsapp_messages%rowtype;
begin
  if btrim(coalesce(p_outbound_intent_key, '')) = '' then
    raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_INVALID';
  end if;
  if p_initiated_at is null then
    raise exception 'TUX_WHATSAPP_INITIATED_AT_REQUIRED';
  end if;
  if p_normalized_phone !~ '^01[0125][0-9]{8}$'
     or p_display_phone !~ '^[+]201[0125][0-9]{8}$' then
    raise exception 'TUX_WHATSAPP_PHONE_INVALID';
  end if;

  select operator.worker_id
    into v_verified_worker_id
  from public.resolve_tux_whatsapp_current_operator_v1(
    p_shop_id,
    p_business_day_id,
    p_claimed_worker_id
  ) operator;

  if v_verified_worker_id is null then
    raise exception 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED';
  end if;

  if not exists (
    select 1
    from public.devices device
    where device.id = p_device_id
      and device.shop_id = p_shop_id
      and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  select template.*
    into v_template
  from public.whatsapp_starter_templates template
  join public.whatsapp_channels channel
    on channel.id = template.channel_id
   and channel.shop_id = p_shop_id
   and channel.active
  where template.id = p_template_id
    and template.shop_id = p_shop_id
    and template.active
    and template.provider_status = 'APPROVED';

  if v_template.id is null then
    raise exception 'TUX_WHATSAPP_TEMPLATE_INVALID';
  end if;

  insert into public.whatsapp_conversations as conversation (
    shop_id,
    normalized_phone,
    display_phone,
    context,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    p_normalized_phone,
    p_display_phone,
    'DIRECT',
    now(),
    now()
  )
  on conflict (shop_id, normalized_phone)
  do update set
    display_phone = excluded.display_phone,
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
    created_at,
    updated_at
  ) values (
    p_shop_id,
    v_conversation_id,
    null,
    p_outbound_intent_key,
    'OUTBOUND',
    'TEXT',
    v_template.preview_text,
    null,
    '{}'::jsonb,
    'PENDING',
    v_verified_worker_id,
    p_device_id,
    p_initiated_at,
    now(),
    now()
  )
  on conflict (shop_id, outbound_intent_key)
    where outbound_intent_key is not null
  do nothing
  returning message.id into v_message_id;

  v_created := v_message_id is not null;

  if v_created then
    select message.*
      into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = v_message_id;
  else
    select message.*
      into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.outbound_intent_key = p_outbound_intent_key;

    if v_message.id is null then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_LOOKUP_FAILED';
    end if;

    if v_message.direction <> 'OUTBOUND'
       or v_message.conversation_id <> v_conversation_id
       or v_message.kind <> 'TEXT'
       or v_message.text is distinct from v_template.preview_text
       or v_message.sent_by_worker_id <> v_verified_worker_id
       or v_message.initiated_by_device_id <> p_device_id then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT';
    end if;
  end if;

  return query
  select
    v_created,
    p_normalized_phone,
    v_template.provider_template_name,
    v_template.language_code,
    to_jsonb(v_message);
end;
$$;

revoke all on function public.claim_tux_whatsapp_template_intent_v1(
  uuid, uuid, uuid, uuid, text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tux_whatsapp_template_intent_v1(
  uuid, uuid, uuid, uuid, text, text, text, uuid, timestamptz
) to service_role;
