import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Catalog migration test refuses a non-loopback PostgreSQL database.');
}

const sql = `
do $$
declare
  v_default text;
  v_result jsonb;
  v_public jsonb;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'menu_categories' and column_name = 'slug'
  ) then raise exception 'menu_categories.slug missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'menu_categories' and column_name = 'description'
  ) then raise exception 'menu_categories.description missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'slug'
  ) then raise exception 'products.slug missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'best_seller'
  ) then raise exception 'products.best_seller missing'; end if;

  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'best_seller';
  if v_default is null or v_default not ilike '%false%' then
    raise exception 'products.best_seller must default false';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'menu_categories_shop_slug_uidx') then
    raise exception 'category shop-scoped slug index missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'products_shop_slug_uidx') then
    raise exception 'product shop-scoped slug index missing';
  end if;
  if to_regclass('public.catalog_admin_command_receipts') is null then
    raise exception 'catalog admin command receipt authority missing';
  end if;
  if to_regprocedure('public.read_catalog_public_v1(uuid)') is null then
    raise exception 'public catalog read RPC missing';
  end if;
  if to_regprocedure('public.apply_catalog_admin_command_v1(uuid,uuid,uuid,jsonb)') is null then
    raise exception 'catalog admin command RPC missing';
  end if;

  insert into auth.users(id) values
    ('a1000000-0000-4000-8000-000000000001'),
    ('a1000000-0000-4000-8000-000000000002')
  on conflict (id) do nothing;

  insert into public.shops(id, name, active)
  values ('11000000-0000-4000-8000-00000000b001', 'Catalog Phase B Test Shop', true)
  on conflict (id) do nothing;

  insert into public.shop_memberships(id, shop_id, auth_user_id, role, active) values
    ('21000000-0000-4000-8000-00000000b001', '11000000-0000-4000-8000-00000000b001', 'a1000000-0000-4000-8000-000000000001', 'ADMIN', true),
    ('21000000-0000-4000-8000-00000000b002', '11000000-0000-4000-8000-00000000b001', 'a1000000-0000-4000-8000-000000000002', 'OPERATIONS_DEVICE', true)
  on conflict (shop_id, auth_user_id) do nothing;

  insert into public.menu_categories(id, shop_id, slug, name, description, sort_order, active)
  values (
    '31000000-0000-4000-8000-00000000b001',
    '11000000-0000-4000-8000-00000000b001',
    'burgers', 'Burgers', 'Catalog test burgers', 1, true
  ) on conflict (id) do nothing;

  insert into public.products(
    id, shop_id, category_id, slug, name, description, price_minor, image_key,
    best_seller, active, sold_out, is_combo, sort_order
  ) values (
    '41000000-0000-4000-8000-00000000b001',
    '11000000-0000-4000-8000-00000000b001',
    '31000000-0000-4000-8000-00000000b001',
    'single-burger', 'Single Burger', 'Catalog test product', 19000, null,
    false, true, false, false, 1
  ) on conflict (id) do nothing;

  select public.read_catalog_public_v1('11000000-0000-4000-8000-00000000b001') into v_public;
  if v_public is null then raise exception 'public read treated existing shop as missing'; end if;
  if jsonb_array_length(v_public -> 'categories') <> 1 then raise exception 'public category projection wrong'; end if;
  if jsonb_array_length(v_public -> 'products') <> 1 then raise exception 'public product projection wrong'; end if;
  if v_public #>> '{products,0,price_minor}' <> '19000' then raise exception 'public minor-unit price changed'; end if;
  if v_public ? 'memberships' or v_public ? 'recipes' or v_public ? 'inventory' or v_public ? 'payments' then
    raise exception 'public catalog projection leaked an internal authority';
  end if;
  if public.read_catalog_public_v1('11000000-0000-4000-8000-00000000b099') is not null then
    raise exception 'unknown shop did not return null';
  end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b001',
    jsonb_build_object('type', 'product.retire', 'productId', '41000000-0000-4000-8000-00000000b001')
  ) into v_result;
  if v_result ->> 'errorCode' <> 'role_forbidden' then
    raise exception 'OPERATIONS_DEVICE was not rejected by admin RPC';
  end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000099',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b002',
    jsonb_build_object('type', 'product.retire', 'productId', '41000000-0000-4000-8000-00000000b001')
  ) into v_result;
  if v_result ->> 'errorCode' <> 'membership_required' then
    raise exception 'unrelated identity was not rejected by admin RPC';
  end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b010',
    jsonb_build_object(
      'type', 'category.create',
      'category', jsonb_build_object(
        'id', '31000000-0000-4000-8000-00000000b010',
        'slug', 'sides', 'name', 'Sides', 'description', null,
        'active', true, 'sortOrder', 2
      )
    )
  ) into v_result;
  if v_result ->> 'status' <> 'applied' then raise exception 'category create command failed'; end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b010',
    jsonb_build_object(
      'type', 'category.create',
      'category', jsonb_build_object(
        'id', '31000000-0000-4000-8000-00000000b010',
        'slug', 'sides', 'name', 'Sides', 'description', null,
        'active', true, 'sortOrder', 2
      )
    )
  ) into v_result;
  if coalesce((v_result ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'same admin command did not replay idempotently';
  end if;
  if (select count(*) from public.menu_categories where id = '31000000-0000-4000-8000-00000000b010') <> 1 then
    raise exception 'idempotent retry duplicated category';
  end if;
  if (select count(*) from public.catalog_admin_command_receipts where command_id = '51000000-0000-4000-8000-00000000b010') <> 1 then
    raise exception 'idempotent retry duplicated receipt';
  end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b010',
    jsonb_build_object('type', 'category.retire', 'categoryId', '31000000-0000-4000-8000-00000000b010')
  ) into v_result;
  if v_result ->> 'errorCode' <> 'command_conflict' then
    raise exception 'command id reuse with different payload was not rejected';
  end if;

  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b020',
    jsonb_build_object(
      'type', 'product.update',
      'productId', '41000000-0000-4000-8000-00000000b001',
      'patch', jsonb_build_object(
        'priceMinor', 20000,
        'active', true,
        'soldOut', true,
        'bestSeller', true,
        'sortOrder', 3
      )
    )
  ) into v_result;
  if v_result ->> 'status' <> 'applied' then raise exception 'product update command failed'; end if;
  if not exists(
    select 1 from public.products
    where id = '41000000-0000-4000-8000-00000000b001'
      and price_minor = 20000 and active = true and sold_out = true and best_seller = true and sort_order = 3
  ) then raise exception 'product canonical flags/price command did not persist'; end if;

  -- Category retirement is deliberately multi-row and atomic: the category and
  -- its products are deactivated but rows remain for durable historical references.
  select public.apply_catalog_admin_command_v1(
    'a1000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-00000000b001',
    '51000000-0000-4000-8000-00000000b030',
    jsonb_build_object('type', 'category.retire', 'categoryId', '31000000-0000-4000-8000-00000000b001')
  ) into v_result;
  if v_result ->> 'status' <> 'retired' then raise exception 'category retire command failed'; end if;
  if not exists(
    select 1 from public.menu_categories
    where id = '31000000-0000-4000-8000-00000000b001' and active = false
  ) then raise exception 'retired category row was removed or left active'; end if;
  if not exists(
    select 1 from public.products
    where id = '41000000-0000-4000-8000-00000000b001' and active = false
  ) then raise exception 'retired category product row was removed or left active'; end if;
end $$;
`;

const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(`Catalog authority migration assertions failed with exit code ${result.status ?? 'unknown'}.`);
}
console.log('Catalog authority migration assertions passed.');
