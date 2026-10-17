-- Correction A: enforce business-wide logical inventory master identity.
-- The trusted create RPC already trims and compares names case-insensitively;
-- this database constraint prevents concurrent commands from creating aliases.
-- Non-destructive, forward-only, and deliberately aborts if historical
-- conflicting identities exist rather than guessing which identity to keep.
do $inventory_master_name_guard$ begin
  if exists (
    select 1
    from public.catalog_master_inventory_items
    group by business_id,lower(btrim(canonical_name))
    having count(*) > 1
  ) then
    raise exception 'inventory_master_normalized_name_conflict';
  end if;
end $inventory_master_name_guard$;

create unique index if not exists catalog_master_inventory_business_normalized_name_uq
  on public.catalog_master_inventory_items (business_id,lower(btrim(canonical_name)));
