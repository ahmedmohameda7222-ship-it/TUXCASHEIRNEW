-- Preserve the canonical relationship between products.is_combo and configured
-- combo beverage options. Repository migration only; do not apply remotely here.

create or replace function private.enforce_combo_beverage_options_product_mode_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.is_combo = true
     and new.is_combo = false
     and exists (
       select 1
       from public.combo_beverage_options option
       where option.shop_id = old.shop_id
         and option.combo_product_id = old.id
     ) then
    raise exception 'TUX_COMBO_BEVERAGE_OPTIONS_REQUIRE_COMBO_PRODUCT';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_combo_beverage_options_product_mode_v1()
  from public, anon, authenticated;

drop trigger if exists products_combo_beverage_options_mode_guard on public.products;
create trigger products_combo_beverage_options_mode_guard
before update of is_combo on public.products
for each row
when (old.is_combo is distinct from new.is_combo)
execute function private.enforce_combo_beverage_options_product_mode_v1();
