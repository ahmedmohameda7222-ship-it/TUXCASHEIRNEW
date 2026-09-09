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

-- Public Edge code uses the anon key, never a service-role credential. This
-- SECURITY DEFINER function is therefore the narrow database read capability.
-- It exposes catalog fields only and cannot expose recipes, inventory, workers,
-- memberships, payments, costs, secrets, or arbitrary table columns.
create or replace function public.read_catalog_public_v1(p_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when s.id is null then null
    else jsonb_build_object(
      'shop', jsonb_build_object('id', s.id, 'active', s.active),
      'categories', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'shop_id', c.shop_id,
            'slug', c.slug,
            'name', c.name,
            'description', c.description,
            'active', c.active,
            'sort_order', c.sort_order
          ) order by c.sort_order, c.id
        )
        from public.menu_categories c
        where c.shop_id = p_shop_id
      ), '[]'::jsonb),
      'products', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'shop_id', p.shop_id,
            'category_id', p.category_id,
            'slug', p.slug,
            'name', p.name,
            'description', p.description,
            'price_minor', p.price_minor,
            'image_key', p.image_key,
            'best_seller', p.best_seller,
            'active', p.active,
            'sold_out', p.sold_out,
            'is_combo', p.is_combo,
            'sort_order', p.sort_order
          ) order by p.category_id, p.sort_order, p.id
        )
        from public.products p
        where p.shop_id = p_shop_id
      ), '[]'::jsonb),
      'modifiers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'shop_id', m.shop_id,
            'name', m.name,
            'price_minor', m.price_minor,
            'active', m.active,
            'sort_order', m.sort_order
          ) order by m.sort_order, m.id
        )
        from public.modifiers m
        where m.shop_id = p_shop_id
      ), '[]'::jsonb),
      'productModifierLinks', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'shop_id', pm.shop_id,
            'product_id', pm.product_id,
            'modifier_id', pm.modifier_id,
            'max_quantity', pm.max_quantity,
            'sort_order', pm.sort_order
          ) order by pm.product_id, pm.sort_order, pm.modifier_id
        )
        from public.product_modifiers pm
        where pm.shop_id = p_shop_id
      ), '[]'::jsonb),
      'comboBeverageOptions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'shop_id', cbo.shop_id,
            'combo_product_id', cbo.combo_product_id,
            'beverage_product_id', cbo.beverage_product_id,
            'sort_order', cbo.sort_order
          ) order by cbo.combo_product_id, cbo.sort_order, cbo.beverage_product_id
        )
        from public.combo_beverage_options cbo
        where cbo.shop_id = p_shop_id
      ), '[]'::jsonb)
    )
  end
  from (
    select sh.id, sh.active
    from public.shops sh
    where sh.id = p_shop_id and sh.active = true
  ) s
  right join (select 1) anchor on true;
$$;

revoke all on function public.read_catalog_public_v1(uuid) from public;

do $$
begin
  if to_regrole('anon') is not null then
    grant execute on function public.read_catalog_public_v1(uuid) to anon;
  end if;
  if to_regrole('authenticated') is not null then
    grant execute on function public.read_catalog_public_v1(uuid) to authenticated;
  end if;
end $$;

-- Catalog images are customer-facing. The bucket is public-readable so the
-- derived image URL is deterministic and therefore safe to include in the
-- content-hash revision. Writes remain controlled by catalog-admin signed-upload
-- ownership; no browser receives privileged storage credentials.
--
-- The repository migration harness intentionally provides a minimal storage.buckets
-- compatibility table. Feature-detect Supabase Storage metadata columns so the full
-- production constraints are configured when they exist without making the root
-- migration chain depend on a synthetic Storage schema implementation.
do $$
declare
  has_storage_metadata boolean;
begin
  if to_regclass('storage.buckets') is not null then
    select
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'storage'
          and table_name = 'buckets'
          and column_name = 'file_size_limit'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'storage'
          and table_name = 'buckets'
          and column_name = 'allowed_mime_types'
      )
    into has_storage_metadata;

    if has_storage_metadata then
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values (
        'catalog-product-images',
        'catalog-product-images',
        true,
        10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[]
      )
      on conflict (id) do update
        set public = excluded.public,
            file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types;
    else
      insert into storage.buckets(id, name, public)
      values ('catalog-product-images', 'catalog-product-images', true)
      on conflict (id) do update
        set public = excluded.public;
    end if;
  end if;
end $$;
