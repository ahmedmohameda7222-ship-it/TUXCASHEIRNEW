-- TUX Operations WhatsApp inbound media materialization v2.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.
-- v1 remains immutable; this function atomically binds validated private media to an inbound message.

create or replace function public.materialize_tux_whatsapp_inbound_v2(
  p_shop_id uuid,
  p_provider_message_id text,
  p_normalized_phone text,
  p_display_phone text,
  p_kind text,
  p_provider_media_id text,
  p_media_key text,
  p_bucket_id text,
  p_object_path text,
  p_mime_type text,
  p_file_name text,
  p_byte_size bigint,
  p_sha256 text,
  p_stored_at timestamptz,
  p_expires_at timestamptz,
  p_provider_occurred_at timestamptz default null
)
returns table(
  message_id uuid,
  media_key text,
  created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_existing_media_key text;
  v_customer_contact_id uuid;
  v_customer_name text;
  v_message_created_at timestamptz := coalesce(p_provider_occurred_at, p_stored_at);
  v_created boolean := false;
begin
  if p_shop_id is null or not exists (
    select 1
    from public.shops shop
    where shop.id = p_shop_id
      and shop.active
  ) then
    raise exception 'TUX_WHATSAPP_SHOP_INVALID';
  end if;

  if p_normalized_phone !~ '^01[0125][0-9]{8}$'
     or p_display_phone !~ '^[+]201[0125][0-9]{8}$' then
    raise exception 'TUX_WHATSAPP_PHONE_INVALID';
  end if;

  if btrim(coalesce(p_provider_message_id, '')) = ''
     or btrim(coalesce(p_provider_media_id, '')) = '' then
    raise exception 'TUX_WHATSAPP_PROVIDER_MEDIA_ID_INVALID';
  end if;

  if p_kind not in ('IMAGE', 'DOCUMENT', 'AUDIO') then
    raise exception 'TUX_WHATSAPP_MEDIA_KIND_INVALID';
  end if;

  if btrim(coalesce(p_media_key, '')) = ''
     or p_bucket_id <> 'tux-whatsapp-media'
     or p_object_path <> 'media/' || p_shop_id::text || '/' || p_media_key
     or btrim(coalesce(p_mime_type, '')) = ''
     or p_byte_size is null
     or p_byte_size < 0
     or p_stored_at is null
     or p_expires_at <> p_stored_at + interval '30 days' then
    raise exception 'TUX_WHATSAPP_MEDIA_METADATA_INVALID';
  end if;

  select message.id, media.media_key
    into v_message_id, v_existing_media_key
  from public.whatsapp_messages message
  join public.whatsapp_media_objects media
    on media.shop_id = message.shop_id
   and media.message_id = message.id
  where message.shop_id = p_shop_id
    and message.provider_message_id = p_provider_message_id;

  if v_message_id is not null then
    if not exists (
      select 1
      from public.whatsapp_messages message
      join public.whatsapp_media_objects media
        on media.shop_id = message.shop_id
       and media.message_id = message.id
      where message.shop_id = p_shop_id
        and message.id = v_message_id
        and message.direction = 'INBOUND'
        and message.kind = p_kind
        and message.media_ref = p_media_key
        and media.media_key = p_media_key
        and media.kind = p_kind
        and media.bucket_id = p_bucket_id
        and media.object_path = p_object_path
        and media.mime_type = p_mime_type
        and media.file_name is not distinct from p_file_name
        and media.byte_size = p_byte_size
        and media.sha256 is not distinct from p_sha256
        and media.provider_media_id = p_provider_media_id
        and media.stored_at = p_stored_at
        and media.expires_at = p_expires_at
    ) then
      raise exception 'TUX_WHATSAPP_INBOUND_MEDIA_CONFLICT';
    end if;

    return query select v_message_id, v_existing_media_key, false;
    return;
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
    null,
    p_media_key,
    '{}'::jsonb,
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
    select message.id, media.media_key
      into v_message_id, v_existing_media_key
    from public.whatsapp_messages message
    join public.whatsapp_media_objects media
      on media.shop_id = message.shop_id
     and media.message_id = message.id
    where message.shop_id = p_shop_id
      and message.provider_message_id = p_provider_message_id;

    if v_message_id is null
       or v_existing_media_key is distinct from p_media_key
       or not exists (
         select 1
         from public.whatsapp_messages message
         join public.whatsapp_media_objects media
           on media.shop_id = message.shop_id
          and media.message_id = message.id
         where message.shop_id = p_shop_id
           and message.id = v_message_id
           and message.direction = 'INBOUND'
           and message.kind = p_kind
           and message.media_ref = p_media_key
           and media.kind = p_kind
           and media.bucket_id = p_bucket_id
           and media.object_path = p_object_path
           and media.mime_type = p_mime_type
           and media.file_name is not distinct from p_file_name
           and media.byte_size = p_byte_size
           and media.sha256 is not distinct from p_sha256
           and media.provider_media_id = p_provider_media_id
           and media.stored_at = p_stored_at
           and media.expires_at = p_expires_at
       ) then
      raise exception 'TUX_WHATSAPP_INBOUND_MEDIA_CONFLICT';
    end if;

    return query select v_message_id, v_existing_media_key, false;
    return;
  end if;

  v_created := true;

  insert into public.whatsapp_media_objects (
    media_key,
    shop_id,
    message_id,
    kind,
    bucket_id,
    object_path,
    mime_type,
    file_name,
    byte_size,
    sha256,
    provider_media_id,
    stored_at,
    expires_at,
    deleted_at
  ) values (
    p_media_key,
    p_shop_id,
    v_message_id,
    p_kind,
    p_bucket_id,
    p_object_path,
    p_mime_type,
    p_file_name,
    p_byte_size,
    p_sha256,
    p_provider_media_id,
    p_stored_at,
    p_expires_at,
    null
  );

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

  return query select v_message_id, p_media_key, v_created;
end;
$$;

revoke all on function public.materialize_tux_whatsapp_inbound_v2(
  uuid, text, text, text, text, text, text, text, text, text, text, bigint, text,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.materialize_tux_whatsapp_inbound_v2(
  uuid, text, text, text, text, text, text, text, text, text, text, bigint, text,
  timestamptz, timestamptz, timestamptz
) to service_role;
