-- Correction A: explicit same-business inventory identities for unit-safe recipe copy.
-- Does not auto-match names, copy stock balances, or create operational items.
create table if not exists public.catalog_master_inventory_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  canonical_name text not null check (btrim(canonical_name)<>''),
  base_unit_label text not null check (btrim(base_unit_label)<>''),
  tracking_mode text not null check (tracking_mode='RECIPE_TRACKED'),
  created_at timestamptz not null default now(),
  unique(business_id,id),
  unique(business_id,canonical_name)
);
create table if not exists public.catalog_inventory_item_shop_bindings (
  business_id uuid not null,
  master_inventory_item_id uuid not null,
  shop_id uuid not null,
  inventory_item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(master_inventory_item_id,shop_id),
  unique(inventory_item_id),
  foreign key(business_id,master_inventory_item_id)
    references public.catalog_master_inventory_items(business_id,id) on delete restrict,
  foreign key(business_id,shop_id)
    references public.business_shops(business_id,shop_id) on delete restrict,
  foreign key(shop_id,inventory_item_id)
    references public.inventory_items(shop_id,id) on delete restrict
);
alter table public.catalog_master_inventory_items enable row level security;
alter table public.catalog_inventory_item_shop_bindings enable row level security;
revoke all on table public.catalog_master_inventory_items from public,anon,authenticated;
revoke all on table public.catalog_inventory_item_shop_bindings from public,anon,authenticated;
grant select,insert,update,delete on table public.catalog_master_inventory_items to service_role;
grant select,insert,update,delete on table public.catalog_inventory_item_shop_bindings to service_role;
