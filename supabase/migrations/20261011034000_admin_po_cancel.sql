-- Non-destructive purchase-order cancellation, preserving all receiving and stock history.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cancel_command_id text;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_shop_cancel_command_idx
  ON public.purchase_orders(shop_id, cancel_command_id)
  WHERE cancel_command_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order_v1(
  p_employee_id uuid, p_shop_id uuid, p_purchase_order_id uuid,
  p_expected_version bigint, p_command_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
  v_existing_order_id uuid;
BEGIN
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );

  IF nullif(btrim(coalesce(p_command_id, '')), '') IS NULL OR length(p_command_id) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_cancel_command');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-purchasing-cancel:' || p_shop_id::text || ':' || p_command_id, 0)
  );

  SELECT po.id INTO v_existing_order_id
    FROM public.purchase_orders po
    WHERE po.shop_id = p_shop_id AND po.cancel_command_id = p_command_id;
  IF v_existing_order_id IS NOT NULL
     AND v_existing_order_id IS DISTINCT FROM p_purchase_order_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  END IF;

  SELECT * INTO v_order
    FROM public.purchase_orders po
    WHERE po.id = p_purchase_order_id AND po.shop_id = p_shop_id
    FOR UPDATE;
  IF NOT FOUND OR v_order.business_id IS DISTINCT FROM v_business_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  END IF;

  IF v_order.cancel_command_id = p_command_id AND v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'status', 'CANCELLED', 'version', v_order.version, 'idempotentReplay', true
    );
  END IF;

  IF v_order.version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version',
      'currentVersion', v_order.version);
  END IF;
  IF v_order.status NOT IN ('DRAFT', 'ORDERED') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'purchase_order_not_cancellable');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchase_receipts pr
    WHERE pr.purchase_order_id = v_order.id
  ) OR EXISTS (
    SELECT 1 FROM public.purchase_order_lines pol
    WHERE pol.purchase_order_id = v_order.id
      AND (pol.received_purchase_units_micros > 0 OR pol.returned_purchase_units_micros > 0)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'purchase_order_receiving_history');
  END IF;

  UPDATE public.purchase_orders SET
    status = 'CANCELLED', cancelled_at = now(),
    cancel_command_id = p_command_id,
    version = version + 1, updated_at = now()
    WHERE id = v_order.id;

  PERFORM public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_CANCELLED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object('status', 'CANCELLED', 'version', v_order.version + 1),
    NULL, NULL, NULL, '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true, 'purchaseOrderId', v_order.id,
    'status', 'CANCELLED', 'version', v_order.version + 1, 'idempotentReplay', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_purchase_order_v1(uuid,uuid,uuid,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order_v1(uuid,uuid,uuid,bigint,text)
  TO service_role;
