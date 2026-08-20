-- Add optional merchandising families inside a top-level menu category.
-- Families are display/navigation metadata (for example TUX / TUXIFY inside Burgers),
-- not separate categories and not part of financial/order semantics.

alter table public.products
  add column family text;

alter table public.products
  add constraint products_family_nonempty
  check (family is null or btrim(family) <> '');

create or replace function public.materialize_product_families_from_configuration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A configuration snapshot is complete for the shop. Clear stale family metadata first,
  -- then materialize the family values from the newly published canonical bundle.
  update public.products
  set family = null
  where shop_id = new.shop_id;

  update public.products as product
  set family = source.family
  from jsonb_to_recordset(new.bundle_json -> 'snapshot' -> 'products') as source(
    id uuid,
    family text
  )
  where product.id = source.id
    and product.shop_id = new.shop_id;

  return new;
end;
$$;

revoke all on function public.materialize_product_families_from_configuration()
  from public, anon, authenticated;

drop trigger if exists operations_configuration_product_family_materializer
  on public.operations_configuration_snapshots;

create trigger operations_configuration_product_family_materializer
after insert on public.operations_configuration_snapshots
for each row
execute function public.materialize_product_families_from_configuration();
