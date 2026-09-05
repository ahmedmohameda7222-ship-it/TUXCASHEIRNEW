-- TUX Operations WhatsApp Current Operator authority and atomic outbound claim.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.

create or replace function public.resolve_tux_whatsapp_current_operator_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid
)
returns table(business_day_id uuid, worker_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select business_day.id, worker.id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.business_day_id = business_day.id
   and worker_session.shop_id = shop.id
  join public.workers worker
    on worker.id = worker_session.worker_id
   and worker.shop_id = shop.id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
    and (
      select count(*)
      from public.worker_sessions open_session
      where open_session.shop_id = shop.id
        and open_session.business_day_id = business_day.id
        and open_session.ended_at is null
    ) = 1
$$;

revoke all on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  to service_role;

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

  select worker.id
    into v_verified_worker_id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.shop_id = shop.id
   and worker_session.business_day_id = business_day.id
  join public.workers worker
    on worker.shop_id = shop.id
   and worker.id = worker_session.worker_id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
    and (
      select count(*)
      from public.worker_sessions open_session
      where open_session.shop_id = shop.id
        and open_session.business_day_id = business_day.id
        and open_session.ended_at is null
    ) = 1
  for share of shop, business_day, worker_session, worker;

  if v_verified_worker_id is null then
    raise exception 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED';
  end if;

  if not exists (
    select 1 from public.devices device
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
    now(),
    now()
  )
  on conflict (shop_id, outbound_intent_key)
    where outbound_intent_key is not null
  do nothing
  returning message.id into v_message_id;

  v_created := v_message_id is not null;

  if v_created then
    select message.* into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = v_message_id;
  else
    select message.* into v_message
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
       or v_message.initiated_by_device_id <> p_device_id then
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

create or replace function public.fail_tux_whatsapp_outbound_intent_v1(
  p_shop_id uuid,
  p_message_id uuid,
  p_failure_code text,
  p_failure_message text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.whatsapp_messages message
     set status = 'FAILED',
         failure_code = nullif(btrim(p_failure_code), ''),
         failure_message = nullif(btrim(p_failure_message), ''),
         updated_at = now()
   where message.shop_id = p_shop_id
     and message.id = p_message_id
     and message.direction = 'OUTBOUND'
     and message.provider_message_id is null
     and message.status = 'PENDING';

  if found then return; end if;

  if exists (
    select 1 from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = p_message_id
      and message.direction = 'OUTBOUND'
      and message.status = 'FAILED'
  ) then
    return;
  end if;

  raise exception 'TUX_WHATSAPP_OUTBOUND_MESSAGE_NOT_FAILABLE';
end;
$$;

revoke all on function public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
  to service_role;

create or replace function public.link_tux_whatsapp_conversation_order_authorized_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_conversation_id uuid,
  p_order_id uuid,
  p_linked boolean default true
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
begin
  select worker.id
    into v_verified_worker_id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.shop_id = shop.id
   and worker_session.business_day_id = business_day.id
  join public.workers worker
    on worker.shop_id = shop.id
   and worker.id = worker_session.worker_id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
  for share of shop, business_day, worker_session, worker;

  if v_verified_worker_id is null then
    raise exception 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED';
  end if;

  if not exists (
    select 1 from public.devices device
    where device.id = p_device_id
      and device.shop_id = p_shop_id
      and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  perform public.link_tux_whatsapp_conversation_order_v1(
    p_shop_id,
    p_conversation_id,
    p_order_id,
    v_verified_worker_id,
    p_device_id,
    p_linked
  );
end;
$$;

revoke all on function public.link_tux_whatsapp_conversation_order_authorized_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.link_tux_whatsapp_conversation_order_authorized_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, boolean
) to service_role;
