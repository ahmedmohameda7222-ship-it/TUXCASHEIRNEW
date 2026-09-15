import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122300_admin_plan2_final_review_round9_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 9 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'publish_catalog_draft_scheduled_v1',
  "'recurring_availability', 'immediate_availability'",
  'published.publish_version > p_expected_base_publish_version',
  'schedule_catalog_draft_v1',
  "v_draft.working_bundle_json -> 'snapshot' -> 'products'",
  "v_draft.working_bundle_json -> 'snapshot' -> 'modifiers'",
  "'catalog.pricing'",
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 9 hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 round 9 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 9 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000129';
const shopId = '12900000-0000-4000-8000-000000000129';
const ownerId = '22900000-0000-4000-8000-000000000129';
const publisherId = '22900000-0000-4000-8000-000000000130';
const categoryId = '32900000-0000-4000-8000-000000000129';
const productId = '42900000-0000-4000-8000-000000000129';
const modifierId = '52900000-0000-4000-8000-000000000129';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Round 9 Fixture', 'Africa/Cairo', 'EGP');
insert into public.shops(id, name, active)
values ('${shopId}', 'Round 9 Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values
  ('${ownerId}', '${businessId}', 'Round 9 Owner', 'OWNER', true),
  ('${publisherId}', '${businessId}', 'Round 9 Publisher', 'STAFF', true);
insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
values ('${businessId}', '${publisherId}', '${shopId}');
insert into public.admin_employee_permissions(business_id, employee_id, permission_key, effect)
values ('${businessId}', '${publisherId}', 'catalog.publish', 'ALLOW');
insert into public.menu_categories(id, shop_id, slug, name, sort_order, active)
values ('${categoryId}', '${shopId}', 'round-9', 'Round 9', 0, true);
insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor,
  active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'round-9-product', 'Round 9 Product',
  'Initial', 1200, true, false, false, 0
);
insert into public.modifiers(id, shop_id, name, price_minor, active, sort_order)
values ('${modifierId}', '${shopId}', 'Round 9 Modifier', 200, true, 0);

do $$
declare
  v_create jsonb;
  v_schedule jsonb;
  v_immediate jsonb;
  v_resume jsonb;
  v_publish jsonb;
  v_apply jsonb;
  v_bundle jsonb;
  v_scheduled_draft_id uuid;
  v_pricing_draft_id uuid;
  v_original_schedule_id uuid;
  v_modifier_index integer;
begin
  -- A schedule created against base 0 must remain publishable after an ordinary persisted
  -- resume advances the same draft base over transient availability publication 1.
  v_create := public.create_catalog_draft_v1(
    '${ownerId}', '${shopId}', 0, 'Scheduled transient rebase continuity'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'round 9 scheduled rebase draft creation failed: %', v_create;
  end if;
  v_scheduled_draft_id := (v_create ->> 'draftId')::uuid;

  v_schedule := public.schedule_catalog_draft_v1(
    '${ownerId}', v_scheduled_draft_id, 1, 0, timestamp '2099-01-01 12:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'round 9 scheduled rebase schedule creation failed: %', v_schedule;
  end if;
  v_original_schedule_id := (v_schedule ->> 'scheduleId')::uuid;

  v_immediate := public.set_immediate_product_availability_v1(
    '${ownerId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 1 then
    raise exception 'round 9 transient publication fixture failed: %', v_immediate;
  end if;

  v_resume := public.resume_catalog_draft_v1(
    '${ownerId}', '${shopId}', v_scheduled_draft_id, 1
  );
  if coalesce((v_resume ->> 'ok')::boolean, false) is not true
     or (v_resume ->> 'basePublishVersion')::bigint <> 1 then
    raise exception 'round 9 ordinary resume did not transient-rebase scheduled draft: %', v_resume;
  end if;

  if not exists (
    select 1
    from public.scheduled_config_changes s
    where s.id = v_original_schedule_id
      and s.status = 'PENDING'
      and s.target_base_publish_version = 0
  ) then
    raise exception 'round 9 resume unexpectedly removed or retargeted original schedule fixture';
  end if;

  v_publish := public.publish_catalog_draft_scheduled_v1(
    '${ownerId}', v_scheduled_draft_id, 1, 0
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 2 then
    raise exception 'scheduled publish did not survive ordinary transient rebase: %', v_publish;
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = true
  ) then
    raise exception 'scheduled transient rebase resurrected stale soldOut state';
  end if;

  -- Build a modifier-only price change under full owner authority, then prove an employee with
  -- catalog.publish but no catalog.pricing cannot accept that draft for later execution.
  v_create := public.create_catalog_draft_v1(
    '${ownerId}', '${shopId}', 2, 'Modifier pricing authority at scheduling'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'round 9 modifier pricing draft creation failed: %', v_create;
  end if;
  v_pricing_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';

  select (ordinality - 1)::integer into v_modifier_index
  from jsonb_array_elements(v_bundle #> '{snapshot,modifiers}') with ordinality as candidate(modifier, ordinality)
  where candidate.modifier ->> 'id' = '${modifierId}'
  limit 1;
  if v_modifier_index is null then
    raise exception 'round 9 modifier fixture missing from draft bundle';
  end if;

  v_bundle := jsonb_set(
    v_bundle,
    array['snapshot', 'modifiers', v_modifier_index::text, 'priceMinor'],
    to_jsonb(450::bigint),
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${ownerId}', v_pricing_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true
     or (v_apply ->> 'draftRevision')::bigint <> 2 then
    raise exception 'round 9 modifier-only draft edit failed: %', v_apply;
  end if;

  begin
    perform public.schedule_catalog_draft_v1(
      '${publisherId}', v_pricing_draft_id, 2, 2, timestamp '2099-01-02 12:00:00'
    );
    raise exception 'round 9 modifier pricing schedule unexpectedly authorized';
  exception
    when others then
      if sqlerrm not like 'TUX_ADMIN_CATALOG_FORBIDDEN:%' then
        raise;
      end if;
  end;

  v_schedule := public.schedule_catalog_draft_v1(
    '${ownerId}', v_pricing_draft_id, 2, 2, timestamp '2099-01-02 12:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true
     or v_schedule ->> 'status' <> 'PENDING' then
    raise exception 'authorized modifier pricing schedule failed: %', v_schedule;
  end if;

  -- Once a durable schedule has been authorized, execution belongs to the scheduler. Revoking the
  -- creating employee must not strand the job, but the original employee remains audit attribution.
  update public.business_employees
  set active = false
  where id = '${ownerId}';

  v_publish := public.publish_catalog_draft_scheduled_v1(
    '${ownerId}', v_pricing_draft_id, 2, 2
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 3 then
    raise exception 'scheduled publish still depended on revoked creator authority: %', v_publish;
  end if;
  if not exists (
    select 1
    from public.catalog_publish_versions published
    where published.shop_id = '${shopId}'
      and published.publish_version = 3
      and published.draft_id = v_pricing_draft_id
      and published.published_by_employee_id = '${ownerId}'
  ) then
    raise exception 'scheduled publish lost creator audit attribution';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Plan 2 round 9 hardening PostgreSQL behavior passed.');
