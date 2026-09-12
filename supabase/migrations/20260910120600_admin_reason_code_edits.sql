-- TUX Admin Plan 2: trusted, version-fenced management for shop-scoped reason codes.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Reason key/family form immutable classification identity after creation; label/active may evolve.

create or replace function public.upsert_admin_reason_code_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_reason_code_id uuid,
  p_reason_key text,
  p_family text,
  p_label text,
  p_active boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_row public.admin_reason_codes%rowtype;
  v_reason_code_id uuid;
  v_next_version bigint;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_reason_key is null
     or p_reason_key !~ '^[a-z][a-z0-9_-]*$'
     or p_family is null
     or p_family not in (
       'CANCELLATION',
       'REFUND_RETURN',
       'DISCOUNT_COMP',
       'WASTE',
       'STOCK_ADJUSTMENT',
       'CASH_VARIANCE',
       'PAY_IN',
       'PAY_OUT'
     )
     or p_label is null
     or btrim(p_label) = ''
     or p_active is null
     or (p_reason_code_id is null and p_expected_version is not null)
     or (p_reason_code_id is not null and (p_expected_version is null or p_expected_version < 1)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason_code_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id,
    p_shop_id,
    'settings.manage'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-reason:' || p_shop_id::text, 0));

  if not exists (
    select 1
    from public.business_shops bs
    where bs.business_id = v_business_id
      and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  if p_reason_code_id is null then
    if exists (
      select 1
      from public.admin_reason_codes r
      where r.business_id = v_business_id
        and r.shop_id = p_shop_id
        and r.family = p_family
        and r.reason_key = p_reason_key
    ) then
      return jsonb_build_object('ok', false, 'code', 'reason_code_conflict');
    end if;

    insert into public.admin_reason_codes (
      business_id,
      shop_id,
      reason_key,
      family,
      label,
      active,
      version,
      updated_by_employee_id
    ) values (
      v_business_id,
      p_shop_id,
      p_reason_key,
      p_family,
      btrim(p_label),
      p_active,
      1,
      p_employee_id
    )
    returning id into v_reason_code_id;

    return jsonb_build_object(
      'ok', true,
      'reasonCodeId', v_reason_code_id,
      'version', 1
    );
  end if;

  select r.*
    into v_row
  from public.admin_reason_codes r
  where r.id = p_reason_code_id
  for update;

  if not found
     or v_row.business_id <> v_business_id
     or v_row.shop_id is distinct from p_shop_id then
    return jsonb_build_object('ok', false, 'code', 'reason_code_not_found');
  end if;

  if v_row.reason_key <> p_reason_key or v_row.family <> p_family then
    return jsonb_build_object('ok', false, 'code', 'reason_code_identity_immutable');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_reason_code_version',
      'currentVersion', v_row.version
    );
  end if;

  v_next_version := v_row.version + 1;
  update public.admin_reason_codes
  set label = btrim(p_label),
      active = p_active,
      version = v_next_version,
      updated_by_employee_id = p_employee_id,
      updated_at = now()
  where id = p_reason_code_id;

  return jsonb_build_object(
    'ok', true,
    'reasonCodeId', p_reason_code_id,
    'version', v_next_version
  );
end;
$$;

revoke all on function public.upsert_admin_reason_code_v1(
  uuid, uuid, uuid, text, text, text, boolean, bigint
) from public, anon, authenticated;

grant execute on function public.upsert_admin_reason_code_v1(
  uuid, uuid, uuid, text, text, text, boolean, bigint
) to service_role;
