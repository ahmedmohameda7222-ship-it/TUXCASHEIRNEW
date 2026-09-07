-- TUX WhatsApp provider-channel ownership mapping.
-- Repository migration only. Do not apply remotely without explicit production authorization.

create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider text not null
    check (provider = 'META_CLOUD_API'),
  provider_phone_number_id text not null
    check (btrim(provider_phone_number_id) <> ''),
  business_phone_e164 text
    check (
      business_phone_e164 is null
      or business_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'
    ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_phone_number_id)
);

create unique index whatsapp_channels_one_active_per_shop
  on public.whatsapp_channels (shop_id)
  where active = true;

alter table public.whatsapp_channels enable row level security;

-- Provider channel ownership is server-only in v1. Browser/device roles receive no
-- direct table access; trusted server code resolves through the functions below.
revoke all on table public.whatsapp_channels from public, anon, authenticated;

create or replace function public.resolve_tux_whatsapp_inbound_channel_v1(
  p_provider text,
  p_provider_phone_number_id text
)
returns table(channel_id uuid, shop_id uuid)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select channel.id, channel.shop_id
  from public.whatsapp_channels channel
  join public.shops shop on shop.id = channel.shop_id
  where channel.provider = p_provider
    and channel.provider_phone_number_id = p_provider_phone_number_id
    and channel.active
    and shop.active
  limit 1
$$;

revoke all on function public.resolve_tux_whatsapp_inbound_channel_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_inbound_channel_v1(text, text)
  to service_role;

create or replace function public.resolve_tux_whatsapp_outbound_channel_v1(
  p_shop_id uuid
)
returns table(
  channel_id uuid,
  provider text,
  provider_phone_number_id text
)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select channel.id, channel.provider, channel.provider_phone_number_id
  from public.whatsapp_channels channel
  join public.shops shop on shop.id = channel.shop_id
  where channel.shop_id = p_shop_id
    and channel.active
    and shop.active
  limit 1
$$;

revoke all on function public.resolve_tux_whatsapp_outbound_channel_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_outbound_channel_v1(uuid)
  to service_role;
