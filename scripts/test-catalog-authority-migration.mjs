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
