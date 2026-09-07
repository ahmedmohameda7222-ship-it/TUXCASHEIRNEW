-- TUX Phase B canonical catalog public identity and merchandising authority.
-- Repository migration only. Do not apply remotely without explicit production authorization.

alter table public.menu_categories
  add column slug text,
  add column description text;

alter table public.menu_categories
  add constraint menu_categories_slug_format_chk
  check (slug is null or (slug = btrim(slug) and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));

create unique index menu_categories_shop_slug_uidx
  on public.menu_categories(shop_id, slug)
  where slug is not null;

alter table public.products
  add column slug text,
  add column best_seller boolean not null default false;

alter table public.products
  add constraint products_slug_format_chk
  check (slug is null or (slug = btrim(slug) and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'));

create unique index products_shop_slug_uidx
  on public.products(shop_id, slug)
  where slug is not null;

-- Canonical product-image bucket is private. Browser writes are expected to use
-- signed upload URLs created only after catalog-admin authorization.
-- Plain PostgreSQL migration smoke does not provide the Supabase storage schema,
-- so bucket creation is conditional while the catalog table changes remain mandatory.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values (
      'catalog-product-images',
      'catalog-product-images',
      false,
      10485760,
      array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[]
    )
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
