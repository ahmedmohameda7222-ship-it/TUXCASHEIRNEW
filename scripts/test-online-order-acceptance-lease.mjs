import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Online-order acceptance lease test refuses a non-loopback PostgreSQL database.');
}

const sql = `
begin;

do $$
begin
  if to_regclass('private.online_order_processing_reservations') is null then
    raise exception 'online order processing reservation history missing';
  end if;
end $$;

insert into public.shops(id, name, active)
values ('15111111-1111-4111-8111-111111111111', 'Task 4 Lease Shop', true);

insert into auth.users(id) values
  ('15911111-1111-4111-8111-111111111111'),
  ('15922222-2222-4222-8222-222222222222');

insert into public.shop_memberships(id, shop_id, auth_user_id, role, active) values
  (
    '15933333-3333-4333-8333-333333333333',
    '15111111-1111-4111-8111-111111111111',
    '15911111-1111-4111-8111-111111111111',
    'OPERATIONS_DEVICE',
    true
  ),
  (
    '15944444-4444-4444-8444-444444444444',
    '15111111-1111-4111-8111-111111111111',
    '15922222-2222-4222-8222-222222222222',
    'OPERATIONS_DEVICE',
    true
  );

insert into public.devices(id, shop_id, label, active, auth_user_id) values
  (
    '15666666-6666-4666-8666-666666666666',
    '15111111-1111-4111-8111-111111111111',
    'Task 4 Lease Origin Device',
    true,
    '15911111-1111-4111-8111-111111111111'
  ),
  (
    '15777777-7777-4777-8777-777777777777',
    '15111111-1111-4111-8111-111111111111',
    'Task 4 Lease Takeover Device',
    true,
    '15922222-2222-4222-8222-222222222222'
  );

insert into public.workers(id, shop_id, display_name, pin_hash, active)
values (
  '15222222-2222-4222-8222-222222222222',
  '15111111-1111-4111-8111-111111111111',
  'Task 4 Worker',
  'test-only',
  true
);

insert into public.business_days(
  id, shop_id, status, started_at, ended_at, started_by_worker_id,
  ended_by_worker_id, last_allocated_display_order_no
) values (
  '15333333-3333-4333-8333-333333333333',
  '15111111-1111-4111-8111-111111111111',
  'OPEN',
  '2026-09-08T08:00:00Z',
  null,
  '15222222-2222-4222-8222-222222222222',
  null,
  2
);

insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
values (
  '15444444-4444-4444-8444-444444444444',
  '15111111-1111-4111-8111-111111111111',
  'Take Away',
  'TAKE_AWAY',
  true,
  0
);

insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note
) values (
  '15aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '15111111-1111-4111-8111-111111111111',
  '15dddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  repeat('a', 64),
  repeat('b', 64),
  'PENDING',
  'PICKUP',
  'CASH',
  'Lease Customer',
  null,
  null,
  '[{"productId":"15555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000,
  null
);

-- This row represents the durable reservation that was legitimately issued before
-- the 12-hour PROCESSING lease expired and the request was requeued to PENDING.
insert into private.online_order_processing_reservations(
  processing_order_id, request_id, shop_id, origin_device_id, reserved_at
) values (
  '15bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  '15aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '15111111-1111-4111-8111-111111111111'::uuid,
  '15666666-6666-4666-8666-666666666666'::uuid,
  '2026-09-08T08:05:00Z'
);

do $$
declare
  v_origin_device_id uuid;
begin
  select origin_device_id
  into v_origin_device_id
  from private.online_order_processing_reservations
  where request_id = '15aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  if v_origin_device_id is distinct from '15666666-6666-4666-8666-666666666666'::uuid then
    raise exception 'historical reservation did not preserve its origin device';
  end if;
end $$;

-- Simulate the delayed outbox materialization after the local ONLINE order was
-- committed while offline and the original processing lease has already expired.
insert into public.orders(
  id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
  operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
  order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
  normalized_phone_snapshot, address_snapshot, delivery_zone_id,
  delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
  items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
) values (
  '15bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  '15111111-1111-4111-8111-111111111111'::uuid,
  '15333333-3333-4333-8333-333333333333'::uuid,
  1,
  '15aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'ONLINE',
  'ACTIVE',
  '15222222-2222-4222-8222-222222222222'::uuid,
  'Task 4 Worker',
  '15444444-4444-4444-8444-444444444444'::uuid,
  'Take Away',
  'TAKE_AWAY',
  null,
  null,
  null,
  null,
  null,
  null,
  0,
  0,
  19000,
  0,
  19000,
  null,
  '2026-09-08T08:06:00Z',
  '2026-09-08T08:06:00Z'
);

do $$
declare
  v_status text;
  v_order_id uuid;
begin
  select status, accepted_order_id
  into v_status, v_order_id
  from public.online_order_requests
  where id = '15aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

  if v_status <> 'ACCEPTED' then
    raise exception 'historically reserved delayed order did not resolve request: %', v_status;
  end if;
  if v_order_id is distinct from '15bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid then
    raise exception 'accepted order identity did not preserve historical reservation';
  end if;
end $$;

-- A later claimant may hold a fresh PROCESSING lease for the preserved order UUID,
-- but it is not the reservation origin. The trusted server materializer must reject
-- its ONLINE payload before any order mutation runs.
insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note,
  processing_device_id, processing_order_id, processing_started_at, processing_expires_at
) values (
  '15aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '15111111-1111-4111-8111-111111111111',
  '15ddddde-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  repeat('c', 64),
  repeat('d', 64),
  'PROCESSING',
  'PICKUP',
  'CASH',
  'Takeover Customer',
  null,
  null,
  '[{"productId":"15555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000,
  null,
  '15777777-7777-4777-8777-777777777777'::uuid,
  '15cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  now(),
  now() + interval '12 hours'
);

insert into private.online_order_processing_reservations(
  processing_order_id, request_id, shop_id, origin_device_id, reserved_at
) values (
  '15cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  '15aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  '15111111-1111-4111-8111-111111111111'::uuid,
  '15666666-6666-4666-8666-666666666666'::uuid,
  '2026-09-08T08:07:00Z'
);

do $$
begin
  begin
    perform public.ingest_tux_operations_materialization_v1(
      '15922222-2222-4222-8222-222222222222'::uuid,
      '15777777-7777-4777-8777-777777777777'::uuid,
      jsonb_build_object(
        'eventId', '15eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'shopId', '15111111-1111-4111-8111-111111111111',
        'idempotencyKey', 'order-placed:15cccccc-cccc-4ccc-8ccc-cccccccccccc',
        'eventType', 'ORDER_PLACED',
        'payloadVersion', 1,
        'aggregateType', 'ORDER',
        'aggregateId', '15cccccc-cccc-4ccc-8ccc-cccccccccccc'
      ),
      repeat('e', 64),
      jsonb_build_object(
        'eventId', '15eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'shopId', '15111111-1111-4111-8111-111111111111',
        'idempotencyKey', 'order-placed:15cccccc-cccc-4ccc-8ccc-cccccccccccc',
        'eventType', 'ORDER_PLACED',
        'mutations', jsonb_build_array(
          jsonb_build_object(
            'table', 'orders',
            'mode', 'UPSERT',
            'conflictColumns', jsonb_build_array('id'),
            'row', jsonb_build_object(
              'id', '15cccccc-cccc-4ccc-8ccc-cccccccccccc',
              'shop_id', '15111111-1111-4111-8111-111111111111',
              'business_day_id', '15333333-3333-4333-8333-333333333333',
              'display_order_no', 2,
              'idempotency_key', '15aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'source', 'ONLINE',
              'status', 'ACTIVE',
              'operator_worker_id', '15222222-2222-4222-8222-222222222222',
              'operator_name_snapshot', 'Task 4 Worker',
              'order_type_id', '15444444-4444-4444-8444-444444444444',
              'order_type_label_snapshot', 'Take Away',
              'order_type_behavior_snapshot', 'TAKE_AWAY',
              'customer_contact_id', null,
              'customer_name_snapshot', null,
              'normalized_phone_snapshot', null,
              'address_snapshot', null,
              'delivery_zone_id', null,
              'delivery_zone_label_snapshot', null,
              'configured_delivery_fee_minor', 0,
              'final_delivery_fee_minor', 0,
              'items_subtotal_minor', 19000,
              'discount_minor', 0,
              'total_minor', 19000,
              'order_note', null,
              'created_at', '2026-09-08T08:08:00Z',
              'updated_at', '2026-09-08T08:08:00Z'
            )
          )
        )
      )
    );
    raise exception 'wrong-device ONLINE materialization unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'wrong-device ONLINE materialization unexpectedly succeeded' then
        raise;
      end if;
      if position('TUX_ONLINE_ORDER_RESERVATION_DEVICE_MISMATCH' in sqlerrm) = 0 then
        raise exception 'unexpected wrong-device materialization error: %', sqlerrm;
      end if;
  end;

  if exists (
    select 1 from public.orders
    where id = '15cccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
  ) then
    raise exception 'wrong-device materialization left a durable ONLINE order';
  end if;

  if (
    select status from public.online_order_requests
    where id = '15aaaaab-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  ) <> 'PROCESSING' then
    raise exception 'wrong-device materialization changed the request lifecycle';
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
    `Online-order acceptance lease assertions failed with exit code ${result.status ?? 'unknown'}.`,
  );
}
console.log('Online-order acceptance lease assertions passed.');