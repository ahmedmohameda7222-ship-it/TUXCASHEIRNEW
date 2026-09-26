import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin customer PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin customer PostgreSQL test refuses non-loopback PostgreSQL.');
}

function psql(args, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.stdout;
}

function rpc(sql, label) {
  return JSON.parse(psql(['-At', '-c', `select (${sql})::text`], label).trim());
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists private cascade;
     create schema private;
     drop schema if exists auth cascade;
     create schema auth;
     drop schema if exists storage cascade;
     create schema storage;
     create table storage.buckets (
       id text primary key,
       name text not null unique,
       public boolean not null default false
     );
     do $$
     begin
       if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit; end if;
     end $$;
     grant usage on schema public to anon, authenticated, service_role;
     create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
     $$;`,
  ],
  'Customer fixture reset',
);

const targetMigration = '20260910180000_admin_loyalty_promotions.sql';
const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Admin loyalty migration missing from repository chain.');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const canonicalPhoneForms = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_array(
        private.canonicalize_egypt_customer_phone_v1('01000000001'),
        private.canonicalize_egypt_customer_phone_v1('+201000000001'),
        private.canonicalize_egypt_customer_phone_v1('00201000000001'),
        private.canonicalize_egypt_customer_phone_v1('201000000001')
      )::text`,
    ],
    'Canonical Egyptian phone forms',
  ).trim(),
);
if (
  canonicalPhoneForms.length !== 4 ||
  canonicalPhoneForms.some((value) => value !== '+201000000001')
) {
  throw new Error(
    `Egyptian phone forms did not converge to one canonical identity: ${JSON.stringify(canonicalPhoneForms)}`,
  );
}

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '61000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '62000000-0000-4000-8000-000000000001';
const SURVIVOR_ID = '63000000-0000-4000-8000-000000000001';
const MERGED_ID = '63000000-0000-4000-8000-000000000002';
const CHAIN_SURVIVOR_ID = '63000000-0000-4000-8000-000000000003';
const CHAIN_PROMOTION_ID = '63000000-0000-4000-8000-000000000004';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values ('${SHOP_ID}', 'Customer Merge Test Shop', true);
     insert into public.business_shops(business_id, shop_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}');
     insert into public.business_employees(id, business_id, display_name, role, active)
       values ('${EMPLOYEE_ID}', '${BUSINESS_ID}', 'Customer Admin', 'OWNER', true);
     insert into public.business_customers(
       id, business_id, normalized_phone, display_name
     ) values
       ('${SURVIVOR_ID}', '${BUSINESS_ID}', '+201000000001', 'Mona'),
       ('${MERGED_ID}', '${BUSINESS_ID}', '+201000000002', 'Mona Old');
     insert into public.customer_addresses(
       business_id, canonical_customer_id, shop_id, address_text, last_used_at
     ) values (
       '${BUSINESS_ID}', '${MERGED_ID}', '${SHOP_ID}', 'Road 9, Maadi',
       '2026-09-22T10:00:00Z'
     );
     insert into public.customer_segments(
       business_id, canonical_customer_id, segment_key, source
     ) values (
       '${BUSINESS_ID}', '${MERGED_ID}', 'VIP', 'SYSTEM'
     );
     insert into public.customer_shop_links(
       business_id, shop_id, canonical_customer_id
     ) values (
       '${BUSINESS_ID}', '${SHOP_ID}', '${MERGED_ID}'
     );
     insert into public.loyalty_programs(
       business_id, enabled, earn_points_per_100_minor,
       redemption_minor_per_point, minimum_redemption_points,
       shop_ids, updated_by_employee_id
     ) values (
       '${BUSINESS_ID}', true, 1, 10, 1, array['${SHOP_ID}'::uuid], '${EMPLOYEE_ID}'
     );
     insert into public.loyalty_ledger(
       business_id, shop_id, customer_id, entry_key, event_type,
       points_delta, created_by_employee_id
     ) values
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${SURVIVOR_ID}',
         'customer-merge-survivor-earn', 'EARN', 40, '${EMPLOYEE_ID}'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${MERGED_ID}',
         'customer-merge-retired-earn', 'EARN', 60, '${EMPLOYEE_ID}'
       );`,
  ],
  'Customer merge fixture seed',
);

const merged = rpc(
  `public.merge_admin_customers_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SURVIVOR_ID}'::uuid,
    '${MERGED_ID}'::uuid,
    true,
    'merge-loyalty-1'
  )`,
  'Customer merge',
);
if (
  merged.ok !== true ||
  merged.survivorCustomerId !== SURVIVOR_ID ||
  merged.mergedCustomerId !== MERGED_ID ||
  merged.replayed !== false
) {
  throw new Error(`customer merge returned unexpected result: ${JSON.stringify(merged)}`);
}

const replay = rpc(
  `public.merge_admin_customers_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SURVIVOR_ID}'::uuid,
    '${MERGED_ID}'::uuid,
    true,
    'merge-loyalty-1'
  )`,
  'Customer merge replay',
);
if (replay.ok !== true || replay.replayed !== true) {
  throw new Error(`customer merge replay was not idempotent: ${JSON.stringify(replay)}`);
}

const readback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'redirect', (
           select merged_into_customer_id
           from public.business_customers
           where id = '${MERGED_ID}'::uuid
         ),
         'survivorAddresses', (
           select count(*) from public.customer_addresses
           where canonical_customer_id = '${SURVIVOR_ID}'::uuid
         ),
         'retiredAddresses', (
           select count(*) from public.customer_addresses
           where canonical_customer_id = '${MERGED_ID}'::uuid
         ),
         'survivorSegments', (
           select count(*) from public.customer_segments
           where canonical_customer_id = '${SURVIVOR_ID}'::uuid
         ),
         'survivorShopLinks', (
           select count(*) from public.customer_shop_links
           where canonical_customer_id = '${SURVIVOR_ID}'::uuid
         ),
         'retiredLedgerRows', (
           select count(*) from public.loyalty_ledger
           where customer_id = '${MERGED_ID}'::uuid
         ),
         'auditCount', (
           select count(*) from public.admin_audit_events
           where business_id = '${BUSINESS_ID}'::uuid
             and action_type = 'CUSTOMER_MERGED'
             and entity_id = '${SURVIVOR_ID}'
         )
       )::text`,
    ],
    'Customer merge readback',
  ).trim(),
);
if (
  readback.redirect !== SURVIVOR_ID ||
  Number(readback.survivorAddresses) !== 1 ||
  Number(readback.retiredAddresses) !== 0 ||
  Number(readback.survivorSegments) !== 1 ||
  Number(readback.survivorShopLinks) !== 1 ||
  Number(readback.retiredLedgerRows) !== 1 ||
  Number(readback.auditCount) !== 1
) {
  throw new Error(`customer merge state is invalid: ${JSON.stringify(readback)}`);
}

const combinedLoyalty = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${SURVIVOR_ID}'::uuid,
    'merge-loyalty-checkout',
    null,
    80,
    'POS',
    10000,
    '{}'::uuid[],
    '{}'::uuid[],
    '2026-09-23T07:00:00Z'::timestamptz
  )`,
  'Merged loyalty balance reservation',
);
if (combinedLoyalty.ok !== true || combinedLoyalty.status !== 'RESERVED') {
  throw new Error(
    `merged customer loyalty state was not combined safely: ${JSON.stringify(combinedLoyalty)}`,
  );
}


const releasedCombinedLoyalty = rpc(
  `public.release_order_reward_reservation_v1(
    '${combinedLoyalty.reservationId}'::uuid,
    '2026-09-23T07:01:00Z'::timestamptz
  )`,
  'Release first-merge loyalty reservation',
);
if (releasedCombinedLoyalty.ok !== true) {
  throw new Error(
    `first-merge loyalty reservation did not release: ${JSON.stringify(releasedCombinedLoyalty)}`,
  );
}

psql(
  [
    '-c',
    `insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values (
         '${CHAIN_SURVIVOR_ID}', '${BUSINESS_ID}', '+201000000003', 'Mona Canonical'
       );
     insert into public.promotion_rules(
       id, business_id, name, active, kind, fixed_discount_minor,
       minimum_order_minor, shop_ids, channel, product_ids, category_ids,
       total_usage_limit, per_customer_usage_limit, stacking_policy,
       version, updated_by_employee_id
     ) values (
       '${CHAIN_PROMOTION_ID}', '${BUSINESS_ID}', 'Chain one-use promotion', true,
       'FIXED', 100, 0, array['${SHOP_ID}'::uuid], 'BOTH',
       '{}'::uuid[], '{}'::uuid[], null, 1, 'ONE_ORDER_LEVEL',
       1, '${EMPLOYEE_ID}'
     );
     insert into public.promotion_usage_ledger(
       business_id, shop_id, promotion_id, customer_id, order_id,
       entry_key, usage_delta, event_type, applied_rule_snapshot
     ) values (
       '${BUSINESS_ID}', '${SHOP_ID}', '${CHAIN_PROMOTION_ID}',
       '${MERGED_ID}', null, 'chain-retired-prior-use',
       1, 'APPLY', '{}'::jsonb
     );`,
  ],
  'Chained customer merge fixture',
);

const chainedMerge = rpc(
  `public.merge_admin_customers_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${CHAIN_SURVIVOR_ID}'::uuid,
    '${SURVIVOR_ID}'::uuid,
    true,
    'merge-loyalty-chain-2'
  )`,
  'Second customer merge in canonical chain',
);
if (
  chainedMerge.ok !== true ||
  chainedMerge.survivorCustomerId !== CHAIN_SURVIVOR_ID ||
  chainedMerge.mergedCustomerId !== SURVIVOR_ID
) {
  throw new Error(`second customer merge failed: ${JSON.stringify(chainedMerge)}`);
}

const chainedReadback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
        'firstRetiredRedirect', (
          select merged_into_customer_id
          from public.business_customers
          where id = '${MERGED_ID}'::uuid
        ),
        'secondRetiredRedirect', (
          select merged_into_customer_id
          from public.business_customers
          where id = '${SURVIVOR_ID}'::uuid
        ),
        'balance', public.get_admin_customer_loyalty_balance_v1(
          '${BUSINESS_ID}'::uuid,
          '${CHAIN_SURVIVOR_ID}'::uuid
        )
      )::text`,
    ],
    'Chained customer merge readback',
  ).trim(),
);
if (
  chainedReadback.firstRetiredRedirect !== CHAIN_SURVIVOR_ID ||
  chainedReadback.secondRetiredRedirect !== CHAIN_SURVIVOR_ID ||
  Number(chainedReadback.balance) !== 100
) {
  throw new Error(
    `chained customer lineage was not flattened safely: ${JSON.stringify(chainedReadback)}`,
  );
}

const chainedPromotionRetry = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CHAIN_SURVIVOR_ID}'::uuid,
    'chain-promotion-retry',
    '${CHAIN_PROMOTION_ID}'::uuid,
    0,
    'POS',
    10000,
    '{}'::uuid[],
    '{}'::uuid[],
    '2026-09-23T07:02:00Z'::timestamptz
  )`,
  'Chained identity per-customer promotion limit',
);
if (
  chainedPromotionRetry.ok !== false ||
  chainedPromotionRetry.code !== 'reward_not_available'
) {
  throw new Error(
    `chained retired identity bypassed promotion usage limit: ${JSON.stringify(chainedPromotionRetry)}`,
  );
}

console.log('Admin customer PostgreSQL merge behavior passed.');
