-- TUX Admin Plan 2 recurring availability rule-update hardening.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Existing active rule effects must be removed before version fencing cancels their old EXIT job.

create or replace function public.save_recurring_availability_rule_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_rule_id uuid,
  p_master_product_id uuid,
  p_days_of_week smallint[],
  p_start_local time without time zone,
  p_end_local time without time zone,
  p_available boolean,
  p_active boolean,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_days smallint[];
  v_existing public.recurring_availability_rules%rowtype;
  v_rule_id uuid;
  v_new_version bigint;
  v_restore jsonb;
begin
  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );

  if p_master_product_id is null
     or p_start_local is null
     or p_end_local is null
     or p_start_local = p_end_local
     or p_available is null
     or p_active is null
     or p_days_of_week is null
     or cardinality(p_days_of_week) < 1
     or cardinality(p_days_of_week) > 7
     or exists (
       select 1
       from unnest(p_days_of_week) as source(day_value)
       where day_value is null or day_value < 0 or day_value > 6
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select array_agg(distinct day_value order by day_value)
    into v_days
  from unnest(p_days_of_week) as source(day_value);

  if not exists (
    select 1
    from public.catalog_product_shop_overrides o
    where o.business_id = v_business_id
      and o.shop_id = p_shop_id
      and o.master_product_id = p_master_product_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'product_not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-admin-recurring:' || p_shop_id::text || ':' || p_master_product_id::text,
      0
    )
  );

  if p_rule_id is not null then
    select * into v_existing
    from public.recurring_availability_rules r
    where r.id = p_rule_id
    for update;

    if not found
       or v_existing.business_id <> v_business_id
       or v_existing.shop_id <> p_shop_id then
      return jsonb_build_object('ok', false, 'code', 'rule_not_found');
    end if;

    if p_expected_version is null or p_expected_version <> v_existing.version then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_rule_version',
        'currentVersion', v_existing.version
      );
    end if;
  elsif p_expected_version is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if p_active and exists (
    select 1
    from public.recurring_availability_rules r
    cross join lateral private.recurring_rule_week_segments_v1(
      r.days_of_week, r.start_local, r.end_local
    ) existing_segment
    cross join lateral private.recurring_rule_week_segments_v1(
      v_days, p_start_local, p_end_local
    ) proposed_segment
    where r.business_id = v_business_id
      and r.shop_id = p_shop_id
      and r.master_product_id = p_master_product_id
      and r.active
      and (p_rule_id is null or r.id <> p_rule_id)
      and int8range(
        existing_segment.segment_start,
        existing_segment.segment_end,
        '[)'
      ) && int8range(
        proposed_segment.segment_start,
        proposed_segment.segment_end,
        '[)'
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'recurring_rule_conflict');
  end if;

  if p_rule_id is null then
    insert into public.recurring_availability_rules(
      business_id,
      shop_id,
      master_product_id,
      created_by_employee_id,
      timezone,
      days_of_week,
      start_local,
      end_local,
      available,
      active,
      version
    ) values (
      v_business_id,
      p_shop_id,
      p_master_product_id,
      p_employee_id,
      'Africa/Cairo',
      v_days,
      p_start_local,
      p_end_local,
      p_available,
      p_active,
      1
    )
    returning id, version into v_rule_id, v_new_version;
  else
    v_rule_id := p_rule_id;

    -- Remove any effect produced by the old active rule before changing its version or shape.
    -- EXIT is idempotent when the canonical product already equals the human manual baseline.
    -- When an ENTER effect is currently active, this appends the immutable restoration history
    -- before the old rule version becomes obsolete and its durable EXIT work is cancelled.
    if v_existing.active then
      v_restore := public.apply_recurring_product_availability_v1(
        p_employee_id,
        p_shop_id,
        v_existing.id,
        v_existing.version,
        'EXIT'
      );
      if coalesce((v_restore ->> 'ok')::boolean, false) is not true then
        raise exception 'TUX_ADMIN_RECURRING_BASELINE_RESTORE_FAILED';
      end if;
    end if;

    v_new_version := v_existing.version + 1;

    update public.recurring_availability_rules r
    set master_product_id = p_master_product_id,
        days_of_week = v_days,
        start_local = p_start_local,
        end_local = p_end_local,
        available = p_available,
        active = p_active,
        version = v_new_version,
        updated_at = now()
    where r.id = v_rule_id;

    -- Old unclaimed materializations are no longer authoritative. A concurrently CLAIMED old
    -- occurrence is harmless because apply_recurring_product_availability_v1 rechecks version.
    update public.scheduled_config_changes s
    set status = 'CANCELLED',
        claimed_at = null,
        last_error = null,
        updated_at = now()
    where s.business_id = v_business_id
      and s.shop_id = p_shop_id
      and s.change_kind = 'PRODUCT_AVAILABILITY'
      and s.status in ('PENDING', 'FAILED')
      and s.payload_json ->> 'ruleId' = v_rule_id::text
      and s.payload_json ->> 'ruleVersion' = v_existing.version::text;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ruleId', v_rule_id,
    'version', v_new_version,
    'timezone', 'Africa/Cairo',
    'active', p_active
  );
end;
$$;
