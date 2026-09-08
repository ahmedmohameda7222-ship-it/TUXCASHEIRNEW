-- TUX public Menu -> Operations online-order intake authority.
-- Repository migration only. Do not apply remotely without explicit production authorization.
-- Public callers never write this table directly; the trusted intake Edge function validates
-- canonical catalog identity/pricing and writes through the service-role boundary.

create table public.online_order_requests (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  idempotency_key uuid not null,
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  catalog_revision text not null
    check (catalog_revision ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'REJECTED')),
  fulfillment_preference text not null
    check (fulfillment_preference in ('DELIVERY', 'PICKUP')),
  payment_preference text not null
    check (payment_preference in ('CASH', 'INSTAPAY', 'MIXED')),
  customer_name text not null
    check (btrim(customer_name) <> ''),
  normalized_phone text
    check (normalized_phone is null or normalized_phone ~ '^01[0-9]{9}$'),
  delivery_address text,
  trusted_items jsonb not null
    check (jsonb_typeof(trusted_items) = 'array' and jsonb_array_length(trusted_items) > 0),
  items_subtotal_minor bigint not null
    check (items_subtotal_minor >= 0),
  order_note text,
  accepted_order_id uuid,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint online_order_requests_shop_id_id_unique unique (shop_id, id),
  constraint online_order_requests_shop_idempotency_unique unique (shop_id, idempotency_key),
  constraint online_order_requests_accepted_order_same_shop_fk
    foreign key (shop_id, accepted_order_id) references public.orders(shop_id, id),
  constraint online_order_requests_delivery_identity_chk
    check (
      (fulfillment_preference = 'DELIVERY' and
        normalized_phone is not null and
        delivery_address is not null and
        btrim(delivery_address) <> '') or
      fulfillment_preference = 'PICKUP'
    ),
  constraint online_order_requests_lifecycle_chk
    check (
      (status = 'PENDING' and
        accepted_order_id is null and
        rejection_reason is null and
        resolved_at is null) or
      (status = 'ACCEPTED' and
        accepted_order_id is not null and
        rejection_reason is null and
        resolved_at is not null) or
      (status = 'REJECTED' and
        accepted_order_id is null and
        btrim(coalesce(rejection_reason, '')) <> '' and
        resolved_at is not null)
    )
);

create unique index online_order_requests_accepted_order_uidx
  on public.online_order_requests(accepted_order_id)
  where accepted_order_id is not null;

create index online_order_requests_pending_shop_created_idx
  on public.online_order_requests(shop_id, created_at)
  where status = 'PENDING';

alter table public.online_order_requests enable row level security;

-- Deliberately no anon/authenticated policy. Public intake and authorized Operations
-- use reviewed server-side capabilities rather than direct table access.
