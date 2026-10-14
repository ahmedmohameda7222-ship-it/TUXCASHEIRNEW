-- Correction A: bind existing canonical category/product UUIDs to their
-- ACTUAL shop. Prior single-column foreign keys validate entity existence but
-- allow a same-business master binding to reference an item in another shop.
-- The isolated PostgreSQL regression demonstrated both wrong-shop writes.
--
-- Fail closed on existing mismatches; never silently reassign shop identities.
do $binding_guard$ begin
  if exists (
    select 1 from public.catalog_category_shop_bindings b
    join public.menu_categories c on c.id=b.canonical_category_id
    where c.shop_id is distinct from b.shop_id
  ) then raise exception 'catalog_category_binding_wrong_shop_history'; end if;
  if exists (
    select 1 from public.catalog_product_shop_overrides b
    join public.products p on p.id=b.canonical_product_id
    where p.shop_id is distinct from b.shop_id
  ) then raise exception 'catalog_product_binding_wrong_shop_history'; end if;
end $binding_guard$;

alter table public.catalog_category_shop_bindings
  add constraint catalog_category_bindings_same_shop_fk
  foreign key (shop_id,canonical_category_id)
  references public.menu_categories(shop_id,id) on delete restrict;

alter table public.catalog_product_shop_overrides
  add constraint catalog_product_overrides_same_shop_fk
  foreign key (shop_id,canonical_product_id)
  references public.products(shop_id,id) on delete restrict;
