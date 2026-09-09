import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Explicit-release transfer test refuses a non-loopback PostgreSQL database.');
}

const sql = `
begin;

insert into public.shops(id, name, active)
values ('17111111-1111-4111-8111-111111111111', 'Explicit Release Shop', true);

insert into auth.users(id) values
  ('17911111-1111-4111-8111-111111111111'),
  ('17922222-2222-4222-8222-222222222222');

insert into public.shop_memberships(id, shop_id, auth_user_id, role, active) values
  ('17933333-3333-4333-8333-333333333333', '17111111-1111-4111-8111-111111111111', '17911111-1111-4111-8111-111111111111', 'OPERATIONS_DEVICE', true),
  ('17944444-4444-4444-8444-444444444444', '17111111-1111-4111-8111-111111111111', '17922222-2222-4222-8222-222222222222', 'OPERATIONS_DEVICE', true);

insert into public.devices(id, shop_id, label, active, auth_user_id) values
  ('17666666-6666-4666-8666-666666666666', '17111111-1111-4111-8111-111111111111', 'Release Origin', true, '17911111-1111-4111-8111-111111111111'),
  ('17777777-7777-4777-8777-777777777777', '17111111-1111-4111-8111-111111111111', 'Next Claimant', true, '17922222-2222-4222-8222-222222222222');

insert into public.online_order_requests(
  id, shop_id, idempotency_key, request_sha256, catalog_revision, status,
  fulfillment_preference, payment_preference, customer_name, normalized_phone,
  delivery_address, trusted_items, items_subtotal_minor, order_note
) values (
  '17aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '17111111-1111-4111-8111-111111111111',
  '17dddddd-dddd-4ddd-8ddd-dddddddddddd',
  repeat('a', 64), repeat('b', 64), 'PENDING', 'PICKUP', 'CASH',
  'Explicit Release Customer', null, null,
  '[{"productId":"17555555-5555-4555-8555-555555555555","quantity":1}]'::jsonb,
  19000, null
);

do $$
declare
  v_first_claim jsonb;
  v_second_claim jsonb;
  v_processing_order_id uuid;
  v_origin uuid;
begin
  v_first_claim := public.claim_tux_online_order_request_v1(
    '17911111-1111-4111-8111-111111111111',
    '17666666-6666-4666-8666-666666666666',
    '17aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  v_processing_order_id := (v_first_claim ->> 'processingOrderId')::uuid;

  perform public.release_tux_online_order_request_claim_v1(
    '17911111-1111-4111-8111-111111111111',
    '17666666-6666-4666-8666-666666666666',
    '17aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    v_processing_order_id
  );

  v_second_claim := public.claim_tux_online_order_request_v1(
    '17922222-2222-4222-8222-222222222222',
    '17777777-7777-4777-8777-777777777777',
    '17aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );

  if v_second_claim ->> 'processingOrderId' <> v_processing_order_id::text then
    raise exception 'explicit release changed the durable processing order identity';
  end if;
  if v_second_claim ->> 'reservationOriginDeviceId' <> '17777777-7777-4777-8777-777777777777' then
    raise exception 'explicit release did not transfer durable reservation ownership';
  end if;

  select origin_device_id into v_origin
  from private.online_order_processing_reservations
  where request_id = '17aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_origin is distinct from '17777777-7777-4777-8777-777777777777'::uuid then
    raise exception 'explicit release transfer was not durable';
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
    `Explicit-release transfer assertions failed with exit code ${result.status ?? 'unknown'}.`,
  );
}
console.log('Explicit-release transfer assertions passed.');
