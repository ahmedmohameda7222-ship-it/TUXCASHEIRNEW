-- Immutable per-payment refund eligibility and a DB-side guard on both direct and approved refunds.
-- Existing payments were created while all method policies were refund-allowed.
ALTER TABLE public.payments
  ADD COLUMN refund_allowed_snapshot boolean;

UPDATE public.payments AS payment
SET refund_allowed_snapshot = method.refund_allowed
FROM public.payment_methods AS method
WHERE method.id = payment.payment_method_id
  AND method.shop_id = payment.shop_id
  AND payment.refund_allowed_snapshot IS NULL;

DO $verify_backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments WHERE refund_allowed_snapshot IS NULL) THEN
    RAISE EXCEPTION 'TUX_ADMIN_REFUND_POLICY_BACKFILL_UNMATCHED_PAYMENT';
  END IF;
END;
$verify_backfill$;

ALTER TABLE public.payments ALTER COLUMN refund_allowed_snapshot SET NOT NULL;
COMMENT ON COLUMN public.payments.refund_allowed_snapshot IS
  'Immutable refund authorization captured from the trusted payment method at the moment of payment creation.';

CREATE OR REPLACE FUNCTION private.capture_payment_refund_policy_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_refund_allowed boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.refund_allowed_snapshot IS DISTINCT FROM OLD.refund_allowed_snapshot
       OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
       OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'TUX_ADMIN_PAYMENT_POLICY_SNAPSHOT_IMMUTABLE'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT method.refund_allowed INTO v_refund_allowed
  FROM public.payment_methods AS method
  WHERE method.id = NEW.payment_method_id AND method.shop_id = NEW.shop_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TUX_ADMIN_PAYMENT_METHOD_NOT_FOUND_FOR_REFUND_POLICY'
      USING ERRCODE = '23503';
  END IF;
  NEW.refund_allowed_snapshot := v_refund_allowed;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_payment_refund_policy_v1()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_capture_refund_policy ON public.payments;
CREATE TRIGGER payments_capture_refund_policy
  BEFORE INSERT OR UPDATE OF refund_allowed_snapshot, payment_method_id, shop_id, order_id
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_payment_refund_policy_v1();

CREATE OR REPLACE FUNCTION private.enforce_admin_refund_payment_policy_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_refund_allowed boolean;
BEGIN
  IF NEW.state IN ('POSTED', 'PENDING_APPROVAL')
     AND (TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    SELECT payment.refund_allowed_snapshot INTO v_refund_allowed
    FROM public.payments AS payment
    WHERE payment.id = NEW.payment_id
      AND payment.shop_id = NEW.shop_id
      AND payment.order_id = NEW.order_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TUX_ADMIN_REFUND_PAYMENT_NOT_FOUND'
        USING ERRCODE = '23503';
    END IF;
    IF NOT v_refund_allowed THEN
      RAISE EXCEPTION 'TUX_ADMIN_PAYMENT_REFUND_NOT_ALLOWED'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_admin_refund_payment_policy_v1()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS admin_order_refunds_enforce_payment_policy
  ON public.admin_order_refunds;
CREATE TRIGGER admin_order_refunds_enforce_payment_policy
  BEFORE INSERT OR UPDATE OF state
  ON public.admin_order_refunds
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_admin_refund_payment_policy_v1();
