-- Shop suspension/reactivation with monotonically versioned, authorized, audited transitions.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS lifecycle_edit_version bigint NOT NULL DEFAULT 1;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.shops'::regclass AND conname='shops_lifecycle_edit_version_positive') THEN
  ALTER TABLE public.shops ADD CONSTRAINT shops_lifecycle_edit_version_positive CHECK (lifecycle_edit_version > 0);
 END IF;
END $guard$;
CREATE TABLE IF NOT EXISTS public.admin_shop_lifecycle_commands (
 business_id uuid NOT NULL,
 shop_id uuid NOT NULL,
 command_id uuid NOT NULL,
 requested_state text NOT NULL CHECK (requested_state IN ('ACTIVE','SUSPENDED')),
 expected_version bigint NOT NULL CHECK (expected_version > 0),
 resulting_version bigint NOT NULL CHECK (resulting_version > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,command_id),
 FOREIGN KEY (business_id,shop_id) REFERENCES public.business_shops(business_id,shop_id) ON DELETE CASCADE
);
ALTER TABLE public.admin_shop_lifecycle_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_shop_lifecycle_commands FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.update_admin_shop_lifecycle_v1(
 p_employee_id uuid,p_shop_id uuid,p_desired_state text,p_expected_version bigint,p_command_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','private'
AS $fn$
DECLARE
 v_business_id uuid;
 v_state text;
 v_version bigint;
 v_actor_role text;
 v_prior record;
BEGIN
 IF p_command_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
   OR p_desired_state IS NULL OR p_desired_state NOT IN ('ACTIVE','SUSPENDED') THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_shop_lifecycle_request');
 END IF;
 v_business_id := private.assert_admin_settings_permission_v1(p_employee_id,p_shop_id,'shops.manage');
 PERFORM pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_shop_id::text,0));
 SELECT s.lifecycle_state,s.lifecycle_edit_version INTO v_state,v_version
 FROM public.shops s JOIN public.business_shops b ON b.shop_id=s.id
 WHERE b.business_id=v_business_id AND s.id=p_shop_id FOR UPDATE OF s;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','shop_not_found'); END IF;
 SELECT c.shop_id,c.requested_state,c.expected_version,c.resulting_version INTO v_prior
 FROM public.admin_shop_lifecycle_commands c
 WHERE c.business_id=v_business_id AND c.command_id=p_command_id;
 IF FOUND THEN
  IF v_prior.shop_id<>p_shop_id OR v_prior.requested_state<>p_desired_state
    OR v_prior.expected_version<>p_expected_version THEN
   RETURN jsonb_build_object('ok',false,'code','shop_lifecycle_command_conflict');
  END IF;
  RETURN jsonb_build_object('ok',true,'lifecycleVersion',v_prior.resulting_version,'idempotentReplay',true);
 END IF;
 IF v_version<>p_expected_version THEN
  RETURN jsonb_build_object('ok',false,'code','stale_shop_lifecycle_version','currentVersion',v_version);
 END IF;
 IF v_state='ARCHIVED' THEN
  RETURN jsonb_build_object('ok',false,'code','archived_shop_not_reactivatable');
 END IF;
 IF v_state<>p_desired_state THEN
  UPDATE public.shops SET lifecycle_state=p_desired_state,
    active=(p_desired_state='ACTIVE'),lifecycle_edit_version=v_version+1,updated_at=clock_timestamp()
  WHERE id=p_shop_id;
  v_version:=v_version+1;
  SELECT e.role INTO STRICT v_actor_role FROM public.business_employees e
    WHERE e.business_id=v_business_id AND e.id=p_employee_id;
  INSERT INTO public.admin_audit_events (
   business_id,shop_id,actor_kind,actor_employee_id,actor_role,
   action_type,entity_type,entity_id,before_value,after_value
  ) VALUES (
   v_business_id,p_shop_id,'HUMAN',p_employee_id,v_actor_role,
   'shop.lifecycle.change','shop',p_shop_id::text,
   jsonb_build_object('lifecycleState',v_state,'lifecycleVersion',v_version-1),
   jsonb_build_object('lifecycleState',p_desired_state,'lifecycleVersion',v_version)
  );
 END IF;
 INSERT INTO public.admin_shop_lifecycle_commands(
   business_id,shop_id,command_id,requested_state,expected_version,resulting_version)
 VALUES(v_business_id,p_shop_id,p_command_id,p_desired_state,p_expected_version,v_version);
 RETURN jsonb_build_object('ok',true,'lifecycleVersion',v_version);
END $fn$;
REVOKE ALL ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,text,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_shop_lifecycle_v1(uuid,uuid,text,bigint,uuid) TO service_role;

-- Existing non-destructive archive logic must treat Admin audit history as usage.
CREATE OR REPLACE FUNCTION public.delete_or_archive_shop_v1(p_employee_id uuid, p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ declare v_business_id uuid;v_used boolean; begin v_business_id:=private.assert_admin_settings_permission_v1(p_employee_id,p_shop_id,'shops.manage'); perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_shop_id::text,0)); perform 1 from public.shops s where s.id=p_shop_id for update; if not found then return jsonb_build_object('ok',false,'code','shop_not_found'); end if; select (exists(select 1 from public.business_days x where x.shop_id=p_shop_id) or exists(select 1 from public.orders x where x.shop_id=p_shop_id) or exists(select 1 from public.operations_configuration_snapshots x where x.shop_id=p_shop_id) or exists(select 1 from public.menu_categories x where x.shop_id=p_shop_id) or exists(select 1 from public.products x where x.shop_id=p_shop_id) or exists(select 1 from public.modifiers x where x.shop_id=p_shop_id) or exists(select 1 from public.inventory_items x where x.shop_id=p_shop_id) or exists(select 1 from public.order_types x where x.shop_id=p_shop_id) or exists(select 1 from public.payment_methods x where x.shop_id=p_shop_id) or exists(select 1 from public.delivery_zones x where x.shop_id=p_shop_id) or exists(select 1 from public.customer_contacts x where x.shop_id=p_shop_id) or exists(select 1 from public.devices x where x.shop_id=p_shop_id) or exists(select 1 from public.workers x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_memberships x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_category_shop_bindings x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_product_shop_overrides x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_drafts x where x.shop_id=p_shop_id) or exists(select 1 from public.catalog_publish_versions x where x.shop_id=p_shop_id) or exists(select 1 from public.scheduled_config_changes x where x.shop_id=p_shop_id) or exists(select 1 from public.recurring_availability_rules x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_setting_overrides x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_settings_versions x where x.shop_id=p_shop_id) or exists(select 1 from public.admin_reason_codes x where x.shop_id=p_shop_id) or exists(select 1 from public.payment_method_zone_rules x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_weekly_hours x where x.shop_id=p_shop_id) or exists(select 1 from public.shop_special_hours x where x.shop_id=p_shop_id) or exists(select 1 from public.admin_audit_events x where x.business_id=v_business_id and x.shop_id=p_shop_id)) into v_used; if v_used then update public.shops set lifecycle_state='ARCHIVED',active=false,updated_at=now() where id=p_shop_id; return jsonb_build_object('ok',true,'action','ARCHIVED'); end if; delete from public.business_shops where business_id=v_business_id and shop_id=p_shop_id; delete from public.shops where id=p_shop_id; return jsonb_build_object('ok',true,'action','DELETED'); end; $function$

