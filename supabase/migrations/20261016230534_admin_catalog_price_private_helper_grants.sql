-- Plan 3 catalog pricing permission hardening after the accepted 20261016213944
-- forward-only price-approval migration. No operational DML.
-- The private helper schema currently denies anon/authenticated USAGE, but
-- implicit PUBLIC function EXECUTE is still an unsafe future permission edge.
revoke all on function private.admin_catalog_price_max_delta_v1(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function private.admin_catalog_price_max_delta_v1(uuid,jsonb)
  to service_role;

revoke all on function private.admin_catalog_price_requires_approval_v1(uuid,uuid,bigint)
  from public,anon,authenticated;
grant execute on function private.admin_catalog_price_requires_approval_v1(uuid,uuid,bigint)
  to service_role;
