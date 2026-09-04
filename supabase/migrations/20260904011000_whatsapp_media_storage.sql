-- TUX Operations WhatsApp private media metadata and retention.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.

insert into storage.buckets (id, name, public)
values ('tux-whatsapp-media', 'tux-whatsapp-media', false)
on conflict (id) do update
set name = excluded.name,
    public = false;

create table public.whatsapp_media_objects (
  media_key text primary key check (btrim(media_key) <> ''),
  shop_id uuid not null references public.shops(id) on delete cascade,
  message_id uuid not null,
  kind text not null check (kind in ('IMAGE', 'DOCUMENT', 'AUDIO')),
  bucket_id text not null check (btrim(bucket_id) <> ''),
  object_path text not null check (btrim(object_path) <> ''),
  mime_type text not null check (btrim(mime_type) <> ''),
  file_name text,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text,
  provider_media_id text,
  stored_at timestamptz not null,
  expires_at timestamptz not null,
  deleted_at timestamptz,
  constraint whatsapp_media_objects_message_same_shop_fk
    foreign key (shop_id, message_id)
      references public.whatsapp_messages(shop_id, id) on delete restrict,
  constraint whatsapp_media_objects_shop_message_unique
    unique (shop_id, message_id),
  constraint whatsapp_media_objects_bucket_path_unique
    unique (bucket_id, object_path),
  constraint whatsapp_media_objects_exact_retention_check
    check (expires_at = stored_at + interval '30 days'),
  constraint whatsapp_media_objects_deleted_after_stored_check
    check (deleted_at is null or deleted_at >= stored_at)
);

create index whatsapp_media_objects_expiry_idx
  on public.whatsapp_media_objects (expires_at, media_key)
  where deleted_at is null;

alter table public.whatsapp_media_objects enable row level security;
revoke all on table public.whatsapp_media_objects from public, anon, authenticated;

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
       and media.message_id = message.id
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

create or replace function public.list_tux_whatsapp_expired_media_v1(
  p_now timestamptz,
  p_limit integer
)
returns table(
  media_key text,
  bucket_id text,
  object_path text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select media.media_key, media.bucket_id, media.object_path
  from public.whatsapp_media_objects media
  where media.deleted_at is null
    and media.expires_at <= p_now
  order by media.expires_at, media.media_key
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

revoke all on function public.list_tux_whatsapp_expired_media_v1(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_tux_whatsapp_expired_media_v1(timestamptz, integer)
  to service_role;

create or replace function public.mark_tux_whatsapp_media_deleted_v1(
  p_media_key text,
  p_deleted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if btrim(coalesce(p_media_key, '')) = '' or p_deleted_at is null then
    raise exception 'TUX_WHATSAPP_MEDIA_DELETE_MARK_INVALID';
  end if;

  update public.whatsapp_media_objects media
     set deleted_at = coalesce(deleted_at, p_deleted_at)
   where media.media_key = p_media_key;
end;
$$;

revoke all on function public.mark_tux_whatsapp_media_deleted_v1(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_tux_whatsapp_media_deleted_v1(text, timestamptz)
  to service_role;
