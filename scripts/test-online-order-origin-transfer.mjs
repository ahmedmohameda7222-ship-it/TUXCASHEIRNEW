import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Online-order origin transfer test refuses a non-loopback PostgreSQL database.');
}

const sql = `
begin;

insert into public.shops(id, name, active)
values ('16111111-1111-4111-8111-111111111111', 'Origin Transfer Shop', true);

insert into auth.users(id) values
  ('16911111-1111-4111-8111-111111111111'),
  ('16922222-2222-4222-8222-222222222222');

insert into public.shop_memberships(id, shop_id, auth_user_id, role, active) values
  (
    '16933333-3333-4333-8333-333333333333',
    '16111111-1111-4111-8111-111111111111',
    '16911111-1111-4111-8111-111111111111',
    'OPERATIONS_DEVICE',
    true
  ),
  (
    '16944444-4444-4444-8444-444444444444',
    '16111111-1111-4111-8111-111111111111',
    '16922222-2222-4222-8222-222222222222',
    'OPERATIONS_DEVICE',
    true
  );

insert into public.devices(id, shop_id, label, active, auth_user_id) values
  (
    '16666666-6666-4666-8666-666666666666',
    '16111111-1111-4111-8111-111111111111',
    'Origin Device',
    true,
    '16911111-1111-4111-8111-111111111111'
  ),
  (
    '16777777-7777-4777-8777-777777777777',
    '16111111-1111-4111-8111-111111111111',
    'Recovery Device',
    true,
    '16922222-2222-4222-8222-222222222222'
  );

-- An expired lease owned by a still-active origin must remain fenced.
insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note,
  processing_device_id, processing_order_id, processing_started_at, processing_expires_at
) values (
  '16aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '16111111-1111-4111-8111-111111111111'::uuid,
  '16dddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  repeat('a', 64),
  repeat('b', 64),
  'PROCESSING',
  'PICKUP',
  'CASH',
  'Active Origin Customer',
  null,
  null,
  '[{"productId":"16555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000,
  null,
  '16666666-6666-4666-8666-666666666666'::uuid,
  '16bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  now() - interval '13 hours',
  now() - interval '1 hour'
);

insert into private.online_order_processing_reservations(
  processing_order_id, request_id, shop_id, origin_device_id, reserved_at
) values (
  '16bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  '16aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '16111111-1111-4111-8111-111111111111'::uuid,
  '16666666-6666-4666-8666-666666666666'::uuid,
  now() - interval '13 hours'
);

do $$
declare
  v_claim jsonb;
begin
  v_claim := public.claim_tux_online_order_request_v1(
    '16922222-2222-4222-8222-222222222222'::uuid,
    '16777777-7777-4777-8777-777777777777'::uuid,
    '16aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );

  if v_claim ->> 'processingDeviceId' <> '16777777-7777-4777-8777-777777777777' then
    raise exception 'recovery device did not receive the expired processing lease';
  end if;
  if v_claim ->> 'reservationOriginDeviceId' <> '16666666-6666-4666-8666-666666666666' then
    raise exception 'active origin reservation ownership transferred unexpectedly';
  end if;
end $$;

-- If the original device is explicitly retired, the next authorized claimant must
-- take reservation ownership transactionally so the request remains recoverable.
insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note,
  processing_device_id, processing_order_id, processing_started_at, processing_expires_at
) values (
  '16aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '16111111-1111-4111-8111-111111111111'::uuid,
  '16ddddde-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  repeat('c', 64),
  repeat('d', 64),
  'PROCESSING',
  'PICKUP',
  'CASH',
  'Retired Origin Customer',
  null,
  null,
  '[{"productId":"16555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000,
  null,
  '16666666-6666-4666-8666-666666666666'::uuid,
  '16cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  now() - interval '13 hours',
  now() - interval '1 hour'
);

insert into private.online_order_processing_reservations(
  processing_order_id, request_id, shop_id, origin_device_id, reserved_at
) values (
  '16cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  '16aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '16111111-1111-4111-8111-111111111111'::uuid,
  '16666666-6666-4666-8666-666666666666'::uuid,
  now() - interval '13 hours'
);

update public.devices
set active = false
where id = '16666666-6666-4666-8666-666666666666'::uuid;

do $$
declare
  v_claim jsonb;
  v_origin uuid;
begin
  v_claim := public.claim_tux_online_order_request_v1(
    '16922222-2222-4222-8222-222222222222'::uuid,
    '16777777-7777-4777-8777-777777777777'::uuid,
    '16aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );

  if v_claim ->> 'reservationOriginDeviceId' <> '16777777-7777-4777-8777-777777777777' then
    raise exception 'retired origin ownership was not transferred to the recovery device';
  end if;

  select origin_device_id
    into v_origin
  from private.online_order_processing_reservations
  where request_id = '16aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  if v_origin is distinct from '16777777-7777-4777-8777-777777777777'::uuid then
    raise exception 'retired origin transfer was not durable';
  end if;
end $$;

-- An explicit Release by an active device must relinquish the durable reservation too.
-- The next active device then receives a fresh reserved order identity that it owns.
update public.devices
set active = true
where id = '16666666-6666-4666-8666-666666666666'::uuid;

insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note
) values (
  '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '16111111-1111-4111-8111-111111111111'::uuid,
  '16dddddf-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  repeat('e', 64),
  repeat('f', 64),
  'PENDING',
  'PICKUP',
  'CASH',
  'Explicit Release Customer',
  null,
  null,
  '[{"productId":"16555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000,
  null
);

do $$
declare
  v_first_claim jsonb;
  v_second_claim jsonb;
  v_first_order_id uuid;
  v_second_order_id uuid;
  v_release jsonb;
  v_reservation_count bigint;
  v_origin uuid;
begin
  v_first_claim := public.claim_tux_online_order_request_v1(
    '16911111-1111-4111-8111-111111111111'::uuid,
    '16666666-6666-4666-8666-666666666666'::uuid,
    '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  v_first_order_id := (v_first_claim ->> 'processingOrderId')::uuid;

  if v_first_claim ->> 'reservationOriginDeviceId' <> '16666666-6666-4666-8666-666666666666' then
    raise exception 'initial explicit-release reservation owner is incorrect';
  end if;

  v_release := public.release_tux_online_order_request_claim_v1(
    '16911111-1111-4111-8111-111111111111'::uuid,
    '16666666-6666-4666-8666-666666666666'::uuid,
    '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    v_first_order_id
  );
  if v_release ->> 'status' <> 'PENDING' then
    raise exception 'explicit release did not return request to pending';
  end if;

  select count(*) into v_reservation_count
  from private.online_order_processing_reservations
  where request_id = '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  if v_reservation_count <> 0 then
    raise exception 'explicit release left a stale durable reservation';
  end if;

  v_second_claim := public.claim_tux_online_order_request_v1(
    '16922222-2222-4222-8222-222222222222'::uuid,
    '16777777-7777-4777-8777-777777777777'::uuid,
    '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  v_second_order_id := (v_second_claim ->> 'processingOrderId')::uuid;

  if v_second_claim ->> 'processingDeviceId' <> '16777777-7777-4777-8777-777777777777' then
    raise exception 'next claimant did not receive the released processing lease';
  end if;
  if v_second_claim ->> 'reservationOriginDeviceId' <> '16777777-7777-4777-8777-777777777777' then
    raise exception 'next claimant did not own the fresh reservation';
  end if;
  if v_second_order_id = v_first_order_id then
    raise exception 'explicit release reused the relinquished order identity';
  end if;

  select origin_device_id into v_origin
  from private.online_order_processing_reservations
  where request_id = '16aaaaac-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    and processing_order_id = v_second_order_id;
  if v_origin is distinct from '16777777-7777-4777-8777-777777777777'::uuid then
    raise exception 'fresh reservation ownership was not durable';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(
    `Online-order origin transfer assertions failed with exit code ${result.status ?? 'unknown'}.`,
  );
}
console.log('Online-order origin transfer assertions passed.');
