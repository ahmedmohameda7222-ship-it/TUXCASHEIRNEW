-- TUX Admin Plan 2 recurring catalog availability.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Weekly Cairo-local rules materialize deterministic durable boundary jobs. Recurring execution
-- never overwrites catalog_product_shop_overrides.manual_sold_out; EXIT restores that current
-- human-controlled baseline instead of applying a hard-coded inverse.

-- Recurring transitions are first-class immutable catalog history entries.
do $$
declare
  v_constraint_name text;
begin
  select c.conname
    into v_constraint_name
  from pg_constraint c
  where c.conrelid = 'public.catalog_publish_versions'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%source_kind%'
    and pg_get_constraintdef(c.oid) ilike '%IMMEDIATE_AVAILABILITY%'
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.catalog_publish_versions drop constraint %I',
      v_constraint_name
    );
  end if;
end $$;

alter table public.catalog_publish_versions
  add constraint catalog_publish_versions_source_kind_v2_ck
  check (
    source_kind in (
      'BASELINE',
      'DRAFT',
      'IMMEDIATE_AVAILABILITY',
      'RECURRING_AVAILABILITY',
      'SCHEDULE',
      'ROLLBACK'
    )
  );

-- Expand a weekly local-time rule into non-wrapping half-open second ranges in one canonical
-- Sunday=0 week. Overnight Saturday rules split at the week boundary so overlap detection stays
-- deterministic without locale/session-timezone dependence.
create or replace function private.recurring_rule_week_segments_v1(
  p_days_of_week smallint[],
  p_start_local time without time zone,
  p_end_local time without time zone
)
returns table(segment_start bigint, segment_end bigint)
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_day smallint;
  v_start_second bigint;
  v_end_second bigint;
  v_duration bigint;
  v_absolute_start bigint;
  v_absolute_end bigint;
begin
  v_start_second := floor(extract(epoch from p_start_local))::bigint;
  v_end_second := floor(extract(epoch from p_end_local))::bigint;
  v_duration := case
    when v_end_second > v_start_second then v_end_second - v_start_second
    else 86400 - v_start_second + v_end_second
  end;

  for v_day in
    select distinct d
    from unnest(p_days_of_week) as source(d)
    order by d
  loop
    v_absolute_start := v_day::bigint * 86400 + v_start_second;
    v_absolute_end := v_absolute_start + v_duration;

    if v_absolute_end <= 604800 then
      segment_start := v_absolute_start;
      segment_end := v_absolute_end;
      return next;
    else
      segment_start := v_absolute_start;
      segment_end := 604800;
      return next;

      segment_start := 0;
      segment_end := v_absolute_end - 604800;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function private.recurring_rule_week_segments_v1(
  smallint[], time without time zone, time without time zone
) from public, anon, authenticated;

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

create or replace function public.materialize_recurring_availability_changes_v1(
  p_now timestamptz default now(),
  p_horizon_days integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rule record;
  v_local_today date;
  v_local_date date;
  v_enter_local timestamp without time zone;
  v_exit_local timestamp without time zone;
  v_inserted integer := 0;
  v_rows integer;
  v_transition text;
  v_local_scheduled_at timestamp without time zone;
  v_occurrence_date date;
  v_key text;
begin
  if p_now is null or p_horizon_days is null or p_horizon_days < 1 or p_horizon_days > 31 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  v_local_today := (p_now at time zone 'Africa/Cairo')::date;

  for v_rule in
    select
      r.id,
      r.business_id,
      r.shop_id,
      r.master_product_id,
      r.created_by_employee_id,
      r.days_of_week,
      r.start_local,
      r.end_local,
      r.available,
      r.version
    from public.recurring_availability_rules r
    where r.active
    order by r.shop_id, r.master_product_id, r.id
  loop
    for v_local_date in
      select generated_day::date
      from generate_series(
        v_local_today - 1,
        v_local_today + p_horizon_days,
        interval '1 day'
      ) as generated_day
    loop
      if extract(dow from v_local_date)::smallint = any(v_rule.days_of_week) then
        v_enter_local := v_local_date + v_rule.start_local;
        v_exit_local := case
          when v_rule.end_local > v_rule.start_local
            then v_local_date + v_rule.end_local
          else v_local_date + 1 + v_rule.end_local
        end;

        foreach v_transition in array array['ENTER', 'EXIT']::text[]
        loop
          v_local_scheduled_at := case
            when v_transition = 'ENTER' then v_enter_local
            else v_exit_local
          end;
          v_occurrence_date := v_local_date;
          v_key := format(
            'recurring:%s:v%s:%s:%s',
            v_rule.id,
            v_rule.version,
            to_char(v_occurrence_date, 'YYYY-MM-DD'),
            lower(v_transition)
          );

          insert into public.scheduled_config_changes(
            business_id,
            shop_id,
            created_by_employee_id,
            change_kind,
            payload_json,
            timezone,
            local_scheduled_at,
            scheduled_for,
            target_base_publish_version,
            idempotency_key,
            status
          ) values (
            v_rule.business_id,
            v_rule.shop_id,
            v_rule.created_by_employee_id,
            'PRODUCT_AVAILABILITY',
            jsonb_build_object(
              'ruleId', v_rule.id,
              'ruleVersion', v_rule.version,
              'transition', v_transition,
              'masterProductId', v_rule.master_product_id
            ),
            'Africa/Cairo',
            v_local_scheduled_at,
            v_local_scheduled_at at time zone 'Africa/Cairo',
            null,
            v_key,
            'PENDING'
          )
          on conflict (shop_id, idempotency_key) do nothing;

          get diagnostics v_rows = row_count;
          v_inserted := v_inserted + v_rows;
        end loop;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'materialized', v_inserted);
end;
$$;

create or replace function public.apply_recurring_product_availability_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_rule_id uuid,
  p_rule_version bigint,
  p_transition text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule public.recurring_availability_rules%rowtype;
  v_business_id uuid;
  v_product_id uuid;
  v_manual_sold_out boolean;
  v_current_sold_out boolean;
  v_target_sold_out boolean;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_rule_id is null
     or p_rule_version is null
     or p_rule_version < 1
     or p_transition not in ('ENTER', 'EXIT') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_rule
  from public.recurring_availability_rules r
  where r.id = p_rule_id
  for update;

  if not found or v_rule.shop_id <> p_shop_id then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );
  if v_business_id <> v_rule.business_id then
    raise exception 'TUX_ADMIN_RECURRING_AVAILABILITY_BUSINESS_MISMATCH';
  end if;

  if not v_rule.active or v_rule.version <> p_rule_version then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select o.canonical_product_id, o.manual_sold_out
    into v_product_id, v_manual_sold_out
  from public.catalog_product_shop_overrides o
  where o.business_id = v_business_id
    and o.shop_id = p_shop_id
    and o.master_product_id = v_rule.master_product_id
  for update;

  if v_product_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_mapping_missing');
  end if;

  select p.sold_out into v_current_sold_out
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_target_sold_out := case
    when p_transition = 'ENTER' then not v_rule.available
    else v_manual_sold_out
  end;

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  if v_current_sold_out = v_target_sold_out then
    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'productId', v_product_id,
      'soldOut', v_target_sold_out,
      'publishVersion', v_current_publish_version,
      'operationsConfigurationVersion', v_current_operations_version
    );
  end if;

  v_bundle := private.build_admin_catalog_bundle_v1(
    p_shop_id, v_current_operations_version, now()
  );

  select jsonb_agg(
    case
      when product ->> 'id' = v_product_id::text
        then jsonb_set(product, '{soldOut}', to_jsonb(v_target_sold_out), true)
      else product
    end
    order by ordinal
  )
  into v_products
  from jsonb_array_elements(v_bundle -> 'snapshot' -> 'products')
    with ordinality as source(product, ordinal);

  if v_products is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_bundle := jsonb_set(v_bundle, '{snapshot,products}', v_products, false);
  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_bundle);

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );

  perform public.publish_tux_operations_configuration(
    p_shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);

  -- Deliberately do not call private.sync_admin_master_catalog_v1 here. That helper mirrors live
  -- sold_out into manual_sold_out, which would destroy the human-controlled baseline this
  -- recurring override must restore on EXIT.
  update public.products
  set sold_out_updated_at = now(),
      sold_out_by_worker_id = null
  where id = v_product_id and shop_id = p_shop_id;

  insert into public.catalog_publish_versions(
    business_id,
    shop_id,
    publish_version,
    operations_configuration_version,
    source_kind,
    published_by_employee_id,
    bundle_json,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_new_publish_version,
    v_new_operations_version,
    'RECURRING_AVAILABILITY',
    p_employee_id,
    v_bundle,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'productId', v_product_id,
    'soldOut', v_target_sold_out,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

revoke all on function public.save_recurring_availability_rule_v1(
  uuid, uuid, uuid, uuid, smallint[], time without time zone,
  time without time zone, boolean, boolean, bigint
) from public, anon, authenticated;
revoke all on function public.materialize_recurring_availability_changes_v1(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.save_recurring_availability_rule_v1(
      uuid, uuid, uuid, uuid, smallint[], time without time zone,
      time without time zone, boolean, boolean, bigint
    ) to service_role;
    grant execute on function public.materialize_recurring_availability_changes_v1(timestamptz, integer)
      to service_role;
    grant execute on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
      to service_role;
  end if;
end $$;
