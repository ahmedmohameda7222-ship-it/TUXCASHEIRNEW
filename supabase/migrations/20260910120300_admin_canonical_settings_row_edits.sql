-- TUX Admin Plan 2 hardening: version-fenced edits for canonical order/payment configuration.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- These management edits remain unpublished until publish_shop_settings_v1 creates the next
-- immutable Operations settings snapshot.

alter table public.order_types
  add column if not exists edit_version bigint not null default 1;
alter table public.payment_methods
  add column if not exists edit_version bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_types'::regclass
      and conname = 'order_types_edit_version_check'
  ) then
    alter table public.order_types
      add constraint order_types_edit_version_check check (edit_version > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_methods'::regclass
      and conname = 'payment_methods_edit_version_check'
  ) then
    alter table public.payment_methods
      add constraint payment_methods_edit_version_check check (edit_version > 0);
  end if;
end $$;

create or replace function public.update_admin_order_type_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_order_type_id uuid,
  p_name text,
  p_behavior text,
  p_active boolean,
  p_sort_order integer,
  p_expected_settings_version bigint,
  p_expected_edit_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_edit_version bigint;
  v_next_edit_version bigint;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_order_type_id is null
     or p_name is null
     or btrim(p_name) = ''
     or p_behavior is null
     or p_behavior not in ('TAKE_AWAY', 'DINE_IN', 'DELIVERY', 'OTHER')
     or p_active is null
     or p_sort_order is null
     or p_expected_settings_version is null
     or p_expected_settings_version < 0
     or p_expected_edit_version is null
     or p_expected_edit_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_order_type_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions s
  where s.shop_id = p_shop_id;

  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  select o.edit_version
    into v_current_edit_version
  from public.order_types o
  where o.id = p_order_type_id and o.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_type_not_found');
  end if;

  if v_current_edit_version <> p_expected_edit_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_edit_version',
      'currentVersion', v_current_edit_version
    );
  end if;

  v_next_edit_version := v_current_edit_version + 1;
  update public.order_types
  set name = btrim(p_name),
      behavior = p_behavior,
      active = p_active,
      sort_order = p_sort_order,
      edit_version = v_next_edit_version,
      updated_at = now()
  where id = p_order_type_id and shop_id = p_shop_id;

  return jsonb_build_object('ok', true, 'editVersion', v_next_edit_version);
end;
$$;
revoke all on function public.update_admin_order_type_v1(
  uuid, uuid, uuid, text, text, boolean, integer, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.update_admin_order_type_v1(
  uuid, uuid, uuid, text, text, boolean, integer, bigint, bigint
) to service_role;

create or replace function public.update_admin_payment_method_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_payment_method_id uuid,
  p_display_name text,
  p_active boolean,
  p_sort_order integer,
  p_channel text,
  p_requires_reference boolean,
  p_manual_confirmation_required boolean,
  p_refund_allowed boolean,
  p_expected_settings_version bigint,
  p_expected_edit_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_edit_version bigint;
  v_next_edit_version bigint;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_payment_method_id is null
     or p_display_name is null
     or btrim(p_display_name) = ''
     or p_active is null
     or p_sort_order is null
     or p_channel is null
     or p_channel not in ('POS', 'ONLINE', 'BOTH')
     or p_requires_reference is null
     or p_manual_confirmation_required is null
     or p_refund_allowed is null
     or p_expected_settings_version is null
     or p_expected_settings_version < 0
     or p_expected_edit_version is null
     or p_expected_edit_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payment_method_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions s
  where s.shop_id = p_shop_id;

  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  select p.edit_version
    into v_current_edit_version
  from public.payment_methods p
  where p.id = p_payment_method_id and p.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_method_not_found');
  end if;

  if v_current_edit_version <> p_expected_edit_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_edit_version',
      'currentVersion', v_current_edit_version
    );
  end if;

  v_next_edit_version := v_current_edit_version + 1;
  update public.payment_methods
  set display_name = btrim(p_display_name),
      active = p_active,
      sort_order = p_sort_order,
      channel = p_channel,
      requires_reference = p_requires_reference,
      manual_confirmation_required = p_manual_confirmation_required,
      refund_allowed = p_refund_allowed,
      edit_version = v_next_edit_version,
      updated_at = now()
  where id = p_payment_method_id and shop_id = p_shop_id;

  return jsonb_build_object('ok', true, 'editVersion', v_next_edit_version);
end;
$$;
revoke all on function public.update_admin_payment_method_v1(
  uuid, uuid, uuid, text, boolean, integer, text, boolean, boolean, boolean, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.update_admin_payment_method_v1(
  uuid, uuid, uuid, text, boolean, integer, text, boolean, boolean, boolean, bigint, bigint
) to service_role;
