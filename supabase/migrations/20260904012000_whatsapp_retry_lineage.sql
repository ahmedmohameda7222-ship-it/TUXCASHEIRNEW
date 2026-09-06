-- TUX Operations WhatsApp outbound media binding and explicit retry lineage.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.
-- Normal text/media/location sends continue to use claim_tux_whatsapp_outbound_intent_v2.

alter table public.whatsapp_messages
  add column retry_of_message_id uuid
  references public.whatsapp_messages(id) on delete restrict;

create index whatsapp_messages_retry_lineage_idx
  on public.whatsapp_messages (shop_id, retry_of_message_id)
  where retry_of_message_id is not null;

create or replace function public.claim_tux_whatsapp_outbound_intent_v2(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_conversation_id uuid,
  p_outbound_intent_key text,
  p_kind text,
  p_text text,
  p_media_ref text,
  p_media_metadata jsonb,
  p_initiated_at timestamptz
)
returns table(
  created boolean,
  recipient_normalized_phone text,
  message_json jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
  v_message_id uuid;
  v_created boolean := false;
  v_recipient_normalized_phone text;
  v_message public.whatsapp_messages%rowtype;
  v_media_key text;
  v_object_path text;
  v_mime_type text;
  v_file_name text;
  v_byte_size bigint;
  v_sha256 text;
  v_stored_at timestamptz;
  v_expires_at timestamptz;
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

  if p_kind in ('IMAGE', 'DOCUMENT', 'AUDIO') then
    if p_media_ref is null
       or btrim(p_media_ref) = ''
       or p_media_metadata is null
       or jsonb_typeof(p_media_metadata) <> 'object'
       or jsonb_typeof(p_media_metadata -> 'byte_size') <> 'number'
       or jsonb_typeof(p_media_metadata -> 'stored_at') <> 'string'
       or jsonb_typeof(p_media_metadata -> 'expires_at') <> 'string' then
      raise exception 'TUX_WHATSAPP_MEDIA_METADATA_INVALID';
    end if;

    v_media_key := nullif(btrim(p_media_metadata ->> 'media_key'), '');
    v_object_path := nullif(btrim(p_media_metadata ->> 'object_path'), '');
    v_mime_type := nullif(btrim(p_media_metadata ->> 'mime_type'), '');
    v_file_name := nullif(btrim(coalesce(p_media_metadata ->> 'file_name', '')), '');
    v_byte_size := (p_media_metadata ->> 'byte_size')::bigint;
    v_sha256 := nullif(btrim(coalesce(p_media_metadata ->> 'sha256', '')), '');
    v_stored_at := (p_media_metadata ->> 'stored_at')::timestamptz;
    v_expires_at := (p_media_metadata ->> 'expires_at')::timestamptz;

    if v_media_key is distinct from p_media_ref
       or v_object_path is distinct from 'media/' || p_shop_id::text || '/' || p_media_ref
       or v_mime_type is null
       or v_byte_size < 0
       or v_stored_at is null
       or v_expires_at is distinct from v_stored_at + interval '30 days' then
      raise exception 'TUX_WHATSAPP_MEDIA_METADATA_INVALID';
    end if;
  end if;

  select current_operator.worker_id
    into v_verified_worker_id
  from public.resolve_tux_whatsapp_current_operator_v1(
    p_shop_id,
    p_business_day_id,
    p_claimed_worker_id
  ) current_operator;

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

  select conversation.normalized_phone
    into v_recipient_normalized_phone
  from public.whatsapp_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.shop_id = p_shop_id;

  if v_recipient_normalized_phone is null then
    raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
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
    retry_of_message_id,
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
    v_verified_worker_id,
    p_device_id,
    p_initiated_at,
    null,
    now(),
    now()
  )
  on conflict (shop_id, outbound_intent_key)
    where outbound_intent_key is not null
  do nothing
  returning message.id into v_message_id;

  v_created := v_message_id is not null;

  if v_created then
    if p_kind in ('IMAGE', 'DOCUMENT', 'AUDIO') then
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
        p_media_ref,
        p_shop_id,
        v_message_id,
        p_kind,
        'tux-whatsapp-media',
        v_object_path,
        v_mime_type,
        v_file_name,
        v_byte_size,
        v_sha256,
        null,
        v_stored_at,
        v_expires_at,
        null
      );
    end if;

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
       or v_message.conversation_id <> p_conversation_id
       or v_message.kind <> p_kind
       or v_message.text is distinct from p_text
       or v_message.media_ref is distinct from p_media_ref
       or v_message.media_metadata is distinct from coalesce(p_media_metadata, '{}'::jsonb)
       or v_message.sent_by_worker_id <> v_verified_worker_id
       or v_message.initiated_by_device_id <> p_device_id
       or v_message.retry_of_message_id is not null then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT';
    end if;

    if p_kind in ('IMAGE', 'DOCUMENT', 'AUDIO') and not exists (
      select 1
      from public.whatsapp_media_objects media
      where media.shop_id = p_shop_id
        and media.message_id = v_message.id
        and media.media_key = p_media_ref
        and media.kind = p_kind
        and media.bucket_id = 'tux-whatsapp-media'
        and media.object_path = v_object_path
        and media.mime_type = v_mime_type
        and media.file_name is not distinct from v_file_name
        and media.byte_size = v_byte_size
        and media.sha256 is not distinct from v_sha256
        and media.stored_at = v_stored_at
        and media.expires_at = v_expires_at
    ) then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT';
    end if;
  end if;

  return query
  select v_created, v_recipient_normalized_phone, to_jsonb(v_message);
end;
$$;

revoke all on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) to service_role;

create or replace function public.get_tux_whatsapp_inbox_v2(
  p_shop_id uuid,
  p_cursor text default null
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
      select jsonb_agg(
        jsonb_build_object(
          'id', message.id,
          'shop_id', message.shop_id,
          'conversation_id', message.conversation_id,
          'provider_message_id', message.provider_message_id,
          'outbound_intent_key', message.outbound_intent_key,
          'direction', message.direction,
          'kind', message.kind,
          'text', message.text,
          'media_ref', message.media_ref,
          'status', message.status,
          'sent_by_worker_id', message.sent_by_worker_id,
          'initiated_by_device_id', message.initiated_by_device_id,
          'initiated_at', message.initiated_at,
          'created_at', message.created_at,
          'updated_at', message.updated_at,
          'media', case
            when message.kind in ('IMAGE', 'DOCUMENT', 'AUDIO') and media.media_key is not null then
              jsonb_build_object(
                'mediaKey', media.media_key,
                'kind', media.kind,
                'mimeType', media.mime_type,
                'fileName', media.file_name,
                'byteSize', media.byte_size,
                'storedAt', media.stored_at,
                'expiresAt', media.expires_at,
                'availability', case
                  when media.deleted_at is not null or media.expires_at <= now() then 'EXPIRED'
                  else 'AVAILABLE'
                end
              )
            else null
          end,
          'location', case
            when message.kind = 'LOCATION' then
              jsonb_build_object(
                'latitude', message.media_metadata -> 'latitude',
                'longitude', message.media_metadata -> 'longitude',
                'name', message.media_metadata -> 'name',
                'address', message.media_metadata -> 'address'
              )
            else null
          end
        )
        order by message.created_at, message.id
      )
      from public.whatsapp_messages message
      left join public.whatsapp_media_objects media
        on media.shop_id = message.shop_id
       and media.media_key = message.media_ref
      where message.shop_id = p_shop_id
        and (
          p_cursor is null
          or message.updated_at > p_cursor::timestamptz
        )
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

revoke all on function public.get_tux_whatsapp_inbox_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_inbox_v2(uuid, text)
  to service_role;

create or replace function public.get_tux_whatsapp_retry_source_v1(
  p_shop_id uuid,
  p_message_id uuid
)
returns table(
  message_json jsonb,
  media_json jsonb,
  location_json jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select
    to_jsonb(message),
    case
      when message.kind in ('IMAGE', 'DOCUMENT', 'AUDIO') and media.media_key is not null then
        jsonb_build_object(
          'media_key', media.media_key,
          'kind', media.kind,
          'mime_type', media.mime_type,
          'file_name', media.file_name,
          'byte_size', media.byte_size,
          'stored_at', media.stored_at,
          'expires_at', media.expires_at,
          'availability', case
            when media.deleted_at is not null or media.expires_at <= now() then 'EXPIRED'
            else 'AVAILABLE'
          end
        )
      else null
    end,
    case
      when message.kind = 'LOCATION' then
        jsonb_build_object(
          'latitude', message.media_metadata -> 'latitude',
          'longitude', message.media_metadata -> 'longitude',
          'name', message.media_metadata -> 'name',
          'address', message.media_metadata -> 'address'
        )
      else null
    end
  from public.whatsapp_messages message
  left join public.whatsapp_media_objects media
    on media.shop_id = message.shop_id
   and media.media_key = message.media_ref
  where message.shop_id = p_shop_id
    and message.id = p_message_id
$$;

revoke all on function public.get_tux_whatsapp_retry_source_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_retry_source_v1(uuid, uuid)
  to service_role;

create or replace function public.get_tux_whatsapp_media_access_v1(
  p_shop_id uuid,
  p_message_id uuid
)
returns table(
  message_id uuid,
  object_path text,
  expires_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select message.id, media.object_path, media.expires_at, media.deleted_at
  from public.whatsapp_messages message
  join public.whatsapp_media_objects media
    on media.shop_id = message.shop_id
   and media.media_key = message.media_ref
  where message.shop_id = p_shop_id
    and message.id = p_message_id
    and message.kind in ('IMAGE', 'DOCUMENT', 'AUDIO')
$$;

revoke all on function public.get_tux_whatsapp_media_access_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_tux_whatsapp_media_access_v1(uuid, uuid)
  to service_role;

create or replace function public.claim_tux_whatsapp_retry_intent_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_failed_message_id uuid,
  p_outbound_intent_key text,
  p_initiated_at timestamptz
)
returns table(
  created boolean,
  recipient_normalized_phone text,
  message_json jsonb,
  media_json jsonb,
  location_json jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
  v_failed public.whatsapp_messages%rowtype;
  v_message public.whatsapp_messages%rowtype;
  v_media public.whatsapp_media_objects%rowtype;
  v_message_id uuid;
  v_created boolean := false;
  v_recipient_normalized_phone text;
  v_media_json jsonb := null;
  v_location_json jsonb := null;
begin
  if btrim(coalesce(p_outbound_intent_key, '')) = '' then
    raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_INVALID';
  end if;
  if p_initiated_at is null then
    raise exception 'TUX_WHATSAPP_INITIATED_AT_REQUIRED';
  end if;

  select current_operator.worker_id
    into v_verified_worker_id
  from public.resolve_tux_whatsapp_current_operator_v1(
    p_shop_id,
    p_business_day_id,
    p_claimed_worker_id
  ) current_operator;

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

  select message.*
    into v_failed
  from public.whatsapp_messages message
  where message.shop_id = p_shop_id
    and message.id = p_failed_message_id;

  if v_failed.id is null then
    raise exception 'TUX_WHATSAPP_RETRY_NOT_ALLOWED';
  end if;
  if v_failed.direction <> 'OUTBOUND'
     or v_failed.status <> 'FAILED' then
    raise exception 'TUX_WHATSAPP_RETRY_NOT_ALLOWED';
  end if;
  if v_failed.kind not in ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION') then
    raise exception 'TUX_WHATSAPP_RETRY_NOT_ALLOWED';
  end if;

  select conversation.normalized_phone
    into v_recipient_normalized_phone
  from public.whatsapp_conversations conversation
  where conversation.shop_id = p_shop_id
    and conversation.id = v_failed.conversation_id;

  if v_recipient_normalized_phone is null then
    raise exception 'TUX_WHATSAPP_RETRY_NOT_ALLOWED';
  end if;

  if v_failed.kind in ('IMAGE', 'DOCUMENT', 'AUDIO') then
    select media.*
      into v_media
    from public.whatsapp_media_objects media
    where media.shop_id = p_shop_id
      and media.media_key = v_failed.media_ref;

    if v_media.media_key is null
       or v_media.deleted_at is not null
       or v_media.expires_at <= now() then
      raise exception 'TUX_WHATSAPP_MEDIA_EXPIRED';
    end if;
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
    retry_of_message_id,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    v_failed.conversation_id,
    null,
    p_outbound_intent_key,
    'OUTBOUND',
    v_failed.kind,
    v_failed.text,
    v_failed.media_ref,
    v_failed.media_metadata,
    'PENDING',
    v_verified_worker_id,
    p_device_id,
    p_initiated_at,
    p_failed_message_id,
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

    if v_message.id is null
       or v_message.direction <> 'OUTBOUND'
       or v_message.conversation_id <> v_failed.conversation_id
       or v_message.kind <> v_failed.kind
       or v_message.text is distinct from v_failed.text
       or v_message.media_ref is distinct from v_failed.media_ref
       or v_message.media_metadata is distinct from v_failed.media_metadata
       or v_message.sent_by_worker_id <> v_verified_worker_id
       or v_message.initiated_by_device_id <> p_device_id
       or v_message.retry_of_message_id is distinct from p_failed_message_id then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT';
    end if;
  end if;

  if v_message.kind in ('IMAGE', 'DOCUMENT', 'AUDIO') then
    if v_media.media_key is null then
      select media.*
        into v_media
      from public.whatsapp_media_objects media
      where media.shop_id = p_shop_id
        and media.media_key = v_message.media_ref;
    end if;

    if v_media.media_key is null
       or v_media.deleted_at is not null
       or v_media.expires_at <= now() then
      raise exception 'TUX_WHATSAPP_MEDIA_EXPIRED';
    end if;

    v_media_json := jsonb_build_object(
      'media_key', v_media.media_key,
      'kind', v_media.kind,
      'mime_type', v_media.mime_type,
      'file_name', v_media.file_name,
      'byte_size', v_media.byte_size,
      'stored_at', v_media.stored_at,
      'expires_at', v_media.expires_at,
      'availability', 'AVAILABLE'
    );
  elsif v_message.kind = 'LOCATION' then
    v_location_json := jsonb_build_object(
      'latitude', v_message.media_metadata -> 'latitude',
      'longitude', v_message.media_metadata -> 'longitude',
      'name', v_message.media_metadata -> 'name',
      'address', v_message.media_metadata -> 'address'
    );
  end if;

  return query
  select
    v_created,
    v_recipient_normalized_phone,
    to_jsonb(v_message),
    v_media_json,
    v_location_json;
end;
$$;

revoke all on function public.claim_tux_whatsapp_retry_intent_v1(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tux_whatsapp_retry_intent_v1(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz
) to service_role;
