-- Forward-only guard during retirement of a parallel lifecycle RPC.
-- Admin BFF uses only the canonical (uuid,uuid,bigint,text,text) signature.
DO $guard$
BEGIN
  IF to_regprocedure('public.update_admin_shop_lifecycle_v1(uuid,uuid,bigint,text,text)') IS NULL
     OR to_regprocedure('public.update_admin_shop_lifecycle_v1(uuid,uuid,text,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Canonical or duplicate shop lifecycle function missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_shop_lifecycle_commands LIMIT 1) THEN
    RAISE EXCEPTION 'Duplicate lifecycle RPC has recorded commands; reconcile history first';
  END IF;
END;
$guard$;
REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,text,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,text,bigint,uuid)
  IS 'Disabled duplicate CAS domain. Canonical Admin BFF uses (uuid,uuid,bigint,text,text). Do not grant EXECUTE.';