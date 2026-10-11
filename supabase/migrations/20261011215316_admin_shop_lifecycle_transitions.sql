-- Canonical Admin shop lifecycle transitions; archived shops remain terminal.
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS lifecycle_revision bigint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.update_admin_shop_lifecycle_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_lifecycle_revision bigint,
  p_expected_state text,
  p_target_state text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_business_id uuid;
  v_current public.shops%ROWTYPE;
  v_actor_role text;
  v_next_revision bigint;
BEGIN
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'shops.manage'
  );
  IF p_expected_lifecycle_revision IS NULL OR p_expected_lifecycle_revision < 1
    OR p_expected_state NOT IN ('ACTIVE', 'SUSPENDED')
    OR p_target_state NOT IN ('ACTIVE', 'SUSPENDED')
    OR p_expected_state = p_target_state THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_lifecycle_transition');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0)
  );
  SELECT s.* INTO v_current
  FROM public.shops s
  JOIN public.business_shops bs
    ON bs.shop_id = s.id AND bs.business_id = v_business_id
  WHERE s.id = p_shop_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'shop_not_found');
  END IF;
  IF v_current.lifecycle_state = 'ARCHIVED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'archived_shop_cannot_reactivate');
  END IF;
  IF v_current.lifecycle_revision <> p_expected_lifecycle_revision
    OR v_current.lifecycle_state <> p_expected_state THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_shop_lifecycle',
      'currentVersion', v_current.lifecycle_revision);
  END IF;

  v_next_revision := v_current.lifecycle_revision + 1;
  -- Suspensions close operational intake; reactivation never silently reopens it.
  UPDATE public.shops SET
    lifecycle_state = p_target_state,
    lifecycle_revision = v_next_revision,
    active = (p_target_state = 'ACTIVE'),
    temporary_closed = true,
    online_orders_paused = true,
    updated_at = now()
  WHERE id = p_shop_id;

  SELECT e.role INTO STRICT v_actor_role
  FROM public.business_employees e
  WHERE e.business_id = v_business_id AND e.id = p_employee_id;
  INSERT INTO public.admin_audit_events (
    business_id, shop_id, actor_kind, actor_employee_id, actor_role,
    action_type, entity_type, entity_id, before_value, after_value
  ) VALUES (
    v_business_id, p_shop_id, 'HUMAN', p_employee_id, v_actor_role,
    'shop.lifecycle.update', 'shop', p_shop_id::text,
    jsonb_build_object('state', v_current.lifecycle_state,
      'revision', v_current.lifecycle_revision,
      'temporaryClosed', v_current.temporary_closed,
      'onlineOrdersPaused', v_current.online_orders_paused),
    jsonb_build_object('state', p_target_state,
      'revision', v_next_revision,
      'temporaryClosed', true, 'onlineOrdersPaused', true)
  );
  RETURN jsonb_build_object('ok', true, 'lifecycleRevision', v_next_revision);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1(
  uuid, uuid, bigint, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_shop_lifecycle_v1(
  uuid, uuid, bigint, text, text
) TO service_role;
