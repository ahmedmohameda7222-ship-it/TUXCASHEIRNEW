-- Forward-only inventory definition management. Existing stock and purchase history is untouched.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS definition_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.inventory_unit_conversions
  ADD COLUMN IF NOT EXISTS definition_version bigint NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.admin_inventory_definition_commands (
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
  command_id text NOT NULL CHECK (length(command_id) BETWEEN 1 AND 160),
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, command_id)
);
ALTER TABLE public.admin_inventory_definition_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_inventory_definition_commands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.admin_inventory_definition_commands TO service_role;

-- Prospective conversions use case-folded active labels, never historical line rewrites.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_unit_conversions_active_label_ci_idx
  ON public.inventory_unit_conversions (shop_id, inventory_item_id, lower(btrim(purchase_unit_label)))
  WHERE active;

CREATE OR REPLACE FUNCTION public.manage_inventory_definition_v1(
  p_employee_id uuid, p_shop_id uuid, p_action text,
  p_entity_id uuid, p_expected_version bigint,
  p_payload jsonb, p_command_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_digest text;
  v_prior public.admin_inventory_definition_commands%rowtype;
  v_item public.inventory_items%rowtype;
  v_conversion public.inventory_unit_conversions%rowtype;
  v_before jsonb;
  v_result jsonb;
  v_name text;
  v_unit text;
  v_mode text;
  v_threshold bigint;
  v_base bigint;
  v_item_id uuid;
  v_label text;
  v_event text;
BEGIN
  -- Checks canonical employee/shop authority even when a service-role caller is compromised.
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );

  IF v_business_id IS NULL OR nullif(btrim(coalesce(p_command_id, '')), '') IS NULL
     OR length(p_command_id) > 160 OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_inventory_definition_command');
  END IF;

  IF p_action NOT IN (
    'item.create', 'item.update', 'item.archive', 'item.restore',
    'conversion.create', 'conversion.update', 'conversion.archive', 'conversion.restore'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unsupported_inventory_definition_action');
  END IF;

  v_digest := md5(jsonb_build_object(
    'action', p_action, 'entityId', p_entity_id,
    'version', p_expected_version, 'payload', p_payload
  )::text);

  -- Lock the idempotency namespace for this shop/command before a read or write.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_command_id, 0));
  SELECT * INTO v_prior
    FROM public.admin_inventory_definition_commands
    WHERE shop_id = p_shop_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_prior.request_digest <> v_digest THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    END IF;
    RETURN v_prior.result || jsonb_build_object('idempotentReplay', true);
  END IF;

  IF p_action LIKE 'item.%' THEN
    IF p_action IN ('item.create', 'item.update') THEN
      IF p_payload - 'name' - 'unitLabel' - 'trackingMode' - 'lowStockThresholdMicros' <> '{}'::jsonb
         OR jsonb_typeof(p_payload->'name') <> 'string'
         OR jsonb_typeof(p_payload->'unitLabel') <> 'string'
         OR jsonb_typeof(p_payload->'trackingMode') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_item_definition');
      END IF;
      v_name := nullif(btrim(p_payload->>'name'), '');
      v_unit := nullif(btrim(p_payload->>'unitLabel'), '');
      v_mode := p_payload->>'trackingMode';
      IF v_name IS NULL OR length(v_name) > 160
         OR v_unit IS NULL OR length(v_unit) > 80
         OR v_mode NOT IN ('RECIPE_TRACKED', 'BULK_MANUAL') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_item_definition');
      END IF;
      IF p_payload ? 'lowStockThresholdMicros'
         AND jsonb_typeof(p_payload->'lowStockThresholdMicros') NOT IN ('number','null') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_low_stock_threshold');
      END IF;
      v_threshold := (p_payload->>'lowStockThresholdMicros')::bigint;
      IF v_threshold < 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_low_stock_threshold');
      END IF;
    ELSIF p_payload <> '{}'::jsonb THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item_lifecycle_payload');
    END IF;

    IF p_action = 'item.create' THEN
      IF p_entity_id IS NOT NULL OR p_expected_version IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_item_create_version');
      END IF;
      INSERT INTO public.inventory_items (
        id, shop_id, name, unit_label, tracking_mode, low_stock_threshold_micros, active
      )
      VALUES (gen_random_uuid(), p_shop_id, v_name, v_unit, v_mode, v_threshold, true)
      ON CONFLICT DO NOTHING RETURNING * INTO v_item;
      IF v_item.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'inventory_name_conflict');
      END IF;
      v_before := NULL;
      v_event := 'INVENTORY_ITEM_CREATED';
    ELSE
      SELECT * INTO v_item FROM public.inventory_items
        WHERE id = p_entity_id AND shop_id = p_shop_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'inventory_item_not_found');
      END IF;
      IF p_expected_version IS DISTINCT FROM v_item.definition_version THEN
        RETURN jsonb_build_object('ok', false, 'code', 'stale_version',
          'currentVersion', v_item.definition_version);
      END IF;
      v_before := to_jsonb(v_item);
      IF p_action = 'item.update' THEN
        -- Never reinterpret base units or tracking mode once used by any stock/recipe/purchase history.
        IF (v_item.unit_label IS DISTINCT FROM v_unit OR
            v_item.tracking_mode IS DISTINCT FROM v_mode) AND (
          EXISTS (SELECT 1 FROM public.inventory_movements WHERE inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.recipe_lines WHERE inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.stocktake_lines WHERE inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.stock_transfer_lines
            WHERE inventory_item_id = v_item.id OR destination_inventory_item_id = v_item.id)
          OR EXISTS (SELECT 1 FROM public.inventory_unit_conversions WHERE inventory_item_id = v_item.id)
        ) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'inventory_semantic_change_forbidden');
        END IF;
        UPDATE public.inventory_items SET
          name = v_name, unit_label = v_unit, tracking_mode = v_mode,
          low_stock_threshold_micros = v_threshold,
          definition_version = definition_version + 1, updated_at = now()
          WHERE id = v_item.id RETURNING * INTO v_item;
        v_event := 'INVENTORY_ITEM_UPDATED';
      ELSE
        UPDATE public.inventory_items SET
          active = (p_action = 'item.restore'),
          definition_version = definition_version + 1, updated_at = now()
          WHERE id = v_item.id RETURNING * INTO v_item;
        v_event := CASE WHEN p_action = 'item.restore'
          THEN 'INVENTORY_ITEM_RESTORED' ELSE 'INVENTORY_ITEM_ARCHIVED' END;
      END IF;
    END IF;
    v_result := jsonb_build_object('ok', true, 'entityId', v_item.id,
      'version', v_item.definition_version, 'active', v_item.active);
    PERFORM public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id, v_event, 'INVENTORY_ITEM', v_item.id::text,
      v_before, to_jsonb(v_item), NULL, NULL, NULL, '{}'::jsonb
    );

  ELSE
    IF p_action = 'conversion.create' THEN
      IF p_payload - 'inventoryItemId' - 'purchaseUnitLabel' - 'baseMicrosPerPurchaseUnit' <> '{}'::jsonb
         OR p_entity_id IS NOT NULL OR p_expected_version IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_conversion_create');
      END IF;
      v_item_id := (p_payload->>'inventoryItemId')::uuid;
    ELSIF p_action = 'conversion.update' THEN
      IF p_payload - 'purchaseUnitLabel' - 'baseMicrosPerPurchaseUnit' <> '{}'::jsonb THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_conversion_update');
      END IF;
    ELSIF p_payload <> '{}'::jsonb THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_conversion_lifecycle_payload');
    END IF;

    IF p_action IN ('conversion.create', 'conversion.update') THEN
      v_label := nullif(btrim(p_payload->>'purchaseUnitLabel'), '');
      IF v_label IS NULL OR length(v_label) > 120
         OR jsonb_typeof(p_payload->'baseMicrosPerPurchaseUnit') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_unit_conversion');
      END IF;
      v_base := (p_payload->>'baseMicrosPerPurchaseUnit')::bigint;
      IF v_base <= 0 OR v_base > 9007199254740991 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_unit_conversion');
      END IF;
    END IF;

    IF p_action = 'conversion.create' THEN
      SELECT * INTO v_item FROM public.inventory_items
        WHERE id = v_item_id AND shop_id = p_shop_id AND active FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'inventory_item_not_found');
      END IF;
      IF lower(v_item.unit_label) = lower(v_label) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'duplicate_purchase_unit');
      END IF;
      INSERT INTO public.inventory_unit_conversions (
        shop_id, inventory_item_id, purchase_unit_label, base_micros_per_purchase_unit, active
      ) VALUES (p_shop_id, v_item_id, v_label, v_base, true)
      ON CONFLICT DO NOTHING RETURNING * INTO v_conversion;
      IF v_conversion.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'duplicate_purchase_unit');
      END IF;
      v_before := NULL;
      v_event := 'INVENTORY_PURCHASE_UNIT_CREATED';
    ELSE
      SELECT * INTO v_conversion FROM public.inventory_unit_conversions
        WHERE id = p_entity_id AND shop_id = p_shop_id FOR UPDATE;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'purchase_unit_not_found');
      END IF;
      IF p_expected_version IS DISTINCT FROM v_conversion.definition_version THEN
        RETURN jsonb_build_object('ok', false, 'code', 'stale_version',
          'currentVersion', v_conversion.definition_version);
      END IF;
      v_before := to_jsonb(v_conversion);
      IF p_action = 'conversion.update' THEN
        SELECT * INTO v_item FROM public.inventory_items
          WHERE id = v_conversion.inventory_item_id AND shop_id = p_shop_id;
        IF lower(v_item.unit_label) = lower(v_label) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'duplicate_purchase_unit');
        END IF;
        UPDATE public.inventory_unit_conversions SET
          purchase_unit_label = v_label, base_micros_per_purchase_unit = v_base,
          definition_version = definition_version + 1, updated_at = now()
          WHERE id = v_conversion.id RETURNING * INTO v_conversion;
        v_event := 'INVENTORY_PURCHASE_UNIT_UPDATED';
      ELSE
        IF p_action = 'conversion.restore' AND EXISTS (
          SELECT 1 FROM public.inventory_unit_conversions u
          WHERE u.shop_id = p_shop_id AND u.inventory_item_id = v_conversion.inventory_item_id
            AND u.active AND u.id <> v_conversion.id
            AND lower(btrim(u.purchase_unit_label)) = lower(btrim(v_conversion.purchase_unit_label))
        ) THEN
          RETURN jsonb_build_object('ok', false, 'code', 'duplicate_purchase_unit');
        END IF;
        UPDATE public.inventory_unit_conversions SET
          active = (p_action = 'conversion.restore'),
          definition_version = definition_version + 1, updated_at = now()
          WHERE id = v_conversion.id RETURNING * INTO v_conversion;
        v_event := CASE WHEN p_action = 'conversion.restore'
          THEN 'INVENTORY_PURCHASE_UNIT_RESTORED'
          ELSE 'INVENTORY_PURCHASE_UNIT_ARCHIVED' END;
      END IF;
    END IF;
    v_result := jsonb_build_object('ok', true, 'entityId', v_conversion.id,
      'version', v_conversion.definition_version, 'active', v_conversion.active);
    PERFORM public.append_admin_audit_event_v1(
      v_business_id, p_shop_id, p_employee_id, v_event, 'INVENTORY_UNIT_CONVERSION',
      v_conversion.id::text, v_before, to_jsonb(v_conversion), NULL, NULL, NULL, '{}'::jsonb
    );
  END IF;

  INSERT INTO public.admin_inventory_definition_commands (shop_id, command_id, request_digest, result)
    VALUES (p_shop_id, p_command_id, v_digest, v_result);
  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'inventory_definition_conflict');
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_inventory_definition_v1(
  uuid, uuid, text, uuid, bigint, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_inventory_definition_v1(
  uuid, uuid, text, uuid, bigint, jsonb, text
) TO service_role;
