-- Prevent a suspended shop from accepting operational or online intake through any writer.
-- This is a cross-app invariant; legacy operational-state commands are fenced too.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.shops'::regclass
      AND conname = 'shops_suspended_intake_closed_ck'
  ) THEN
    ALTER TABLE public.shops
      ADD CONSTRAINT shops_suspended_intake_closed_ck
      CHECK (
        lifecycle_state <> 'SUSPENDED'
        OR (NOT active AND temporary_closed AND online_orders_paused)
      );
  END IF;
END;
$guard$;
COMMENT ON CONSTRAINT shops_suspended_intake_closed_ck ON public.shops IS
  'Suspended shops cannot be active or accept operational/online orders, regardless of write path.';
