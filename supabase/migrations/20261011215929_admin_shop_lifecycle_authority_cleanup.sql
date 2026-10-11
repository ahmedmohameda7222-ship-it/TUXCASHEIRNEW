-- Forward-only correction: retain the original canonical lifecycle revision/RPC authority.
-- A later migration accidentally introduced an unused parallel signature and version column.
-- Refuse cleanup if any data was recorded by that parallel authority.
BEGIN;
BEGIN;
LOCK TABLE public.admin_shop_lifecycle_commands IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.shops IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_shop_lifecycle_commands)
     OR EXISTS (SELECT 1 FROM public.shops WHERE lifecycle_edit_version <> 1)
  THEN
    RAISE EXCEPTION 'TUX_ADMIN_DUPLICATE_LIFECYCLE_AUTHORITY_IN_USE';
  END IF;
END;
$guard$;

DROP FUNCTION IF EXISTS public.update_admin_shop_lifecycle_v1(uuid, uuid, text, bigint, uuid);
DROP TABLE public.admin_shop_lifecycle_commands;
ALTER TABLE public.shops DROP COLUMN lifecycle_edit_version;

-- The canonical function (uuid,uuid,bigint,text,text) and its lifecycle_revision remain intact.
-- The applied archive historical-audit guard from the prior migration is retained.
COMMIT;
COMMIT;
