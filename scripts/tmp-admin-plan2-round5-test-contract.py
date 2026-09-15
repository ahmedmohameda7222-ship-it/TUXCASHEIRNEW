from pathlib import Path

path = Path('scripts/test-admin-plan2-round4-hardening.mjs')
text = path.read_text()
start = text.index('create temp table round4_settings_publish_calls(')
end = text.index('\nrollback;\n', start)
replacement = r'''-- Round 5 security contract: emergency toggles publish from the latest immutable
-- Operations bundle and must not route through mutable staged Admin settings.
insert into public.operations_configuration_snapshots(
  shop_id, version, bundle_json, published_at, published_by_auth_user_id
) values (
  '${shopId}', 7,
  jsonb_build_object(
    'snapshot', jsonb_build_object(
      'shopId', '${shopId}',
      'version', 7,
      'updatedAt', '2026-09-14T23:00:00.000Z',
      'settings', jsonb_build_object(
        'version', 44,
        'values', jsonb_build_object('checkout.minimumOrderMinor', 111),
        'shopIdentity', jsonb_build_object(
          'publishedSentinel', 'keep-me',
          'temporaryClosed', false,
          'onlineOrdersPaused', false
        ),
        'weeklyHours', '[]'::jsonb,
        'specialHours', '[]'::jsonb,
        'paymentMethodZoneRules', '[]'::jsonb
      )
    )
  ),
  '2026-09-14 23:00:00+00'::timestamptz,
  null
);

insert into public.shop_setting_overrides(
  business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
) values (
  '${businessId}', '${shopId}', 'checkout.minimumOrderMinor', '9999'::jsonb, 1, '${employeeId}'
);

-- Keep a hostile replacement in place: the emergency path must not call this function at all.
create or replace function public.publish_shop_settings_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_settings_version bigint
)
returns jsonb
language plpgsql
as $stub$
begin
  raise exception 'ROUND5_EMERGENCY_MUST_NOT_CALL_SETTINGS_PUBLISH';
end;
$stub$;

do $$
declare
  v_result jsonb;
  v_closed boolean;
  v_paused boolean;
  v_published_value text;
  v_published_sentinel text;
  v_snapshot_version integer;
begin
  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', true, true, 0
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1
     or (v_result ->> 'operationsConfigurationVersion')::integer <> 8 then
    raise exception 'operational-state immutable publish failed: %', v_result;
  end if;

  select s.temporary_closed, s.online_orders_paused
    into v_closed, v_paused
  from public.shops s
  where s.id = '${shopId}';
  if v_closed is not true or v_paused is not true then
    raise exception 'operational-state flags were not updated';
  end if;

  select
    version.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}',
    version.bundle_json #>> '{snapshot,settings,shopIdentity,publishedSentinel}'
  into v_published_value, v_published_sentinel
  from public.shop_settings_versions version
  where version.shop_id = '${shopId}'
    and version.settings_version = 1;

  if v_published_value is distinct from '111'
     or v_published_sentinel is distinct from 'keep-me' then
    raise exception 'emergency publish leaked staged settings or lost published state: value %, sentinel %',
      v_published_value, v_published_sentinel;
  end if;

  select snapshot.version,
         snapshot.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}',
         snapshot.bundle_json #>> '{snapshot,settings,shopIdentity,publishedSentinel}'
    into v_snapshot_version, v_published_value, v_published_sentinel
  from public.operations_configuration_snapshots snapshot
  where snapshot.shop_id = '${shopId}'
  order by snapshot.version desc
  limit 1;

  if v_snapshot_version <> 8
     or v_published_value is distinct from '111'
     or v_published_sentinel is distinct from 'keep-me' then
    raise exception 'Operations snapshot did not preserve immutable published settings';
  end if;

  if exists (
    select 1
    from public.shop_settings_versions version
    where version.shop_id = '${shopId}'
      and version.settings_version = 1
      and version.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' = '9999'
  ) then
    raise exception 'staged settings override leaked into emergency publish';
  end if;

  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', false, false, 0
  );
  if v_result ->> 'code' <> 'stale_settings_version'
     or (v_result ->> 'currentVersion')::bigint <> 1 then
    raise exception 'operational-state CAS did not reject stale version: %', v_result;
  end if;

  select s.temporary_closed, s.online_orders_paused
    into v_closed, v_paused
  from public.shops s
  where s.id = '${shopId}';
  if v_closed is not true or v_paused is not true then
    raise exception 'stale operational-state command mutated canonical flags';
  end if;
end $$;
'''
path.write_text(text[:start] + replacement + text[end:])
