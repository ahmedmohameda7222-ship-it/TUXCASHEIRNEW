import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Online-order intake migration test refuses a non-loopback PostgreSQL database.');
}

const sql = `
do $$
declare
  v_rls boolean;
  v_unique_count integer;
begin
  if to_regclass('public.online_order_requests') is null then
    raise exception 'online_order_requests table missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'id'
  ) then raise exception 'online_order_requests.id missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'shop_id'
  ) then raise exception 'online_order_requests.shop_id missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'idempotency_key'
  ) then raise exception 'online_order_requests.idempotency_key missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'status'
  ) then raise exception 'online_order_requests.status missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'fulfillment_preference'
  ) then raise exception 'online_order_requests.fulfillment_preference missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'payment_preference'
  ) then raise exception 'online_order_requests.payment_preference missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'customer_name'
  ) then raise exception 'online_order_requests.customer_name missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'normalized_phone'
  ) then raise exception 'online_order_requests.normalized_phone missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'delivery_address'
  ) then raise exception 'online_order_requests.delivery_address missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'trusted_items'
  ) then raise exception 'online_order_requests.trusted_items missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'items_subtotal_minor'
  ) then raise exception 'online_order_requests.items_subtotal_minor missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'accepted_order_id'
  ) then raise exception 'online_order_requests.accepted_order_id missing'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'processing_device_id'
  ) then raise exception 'online_order_requests.processing_device_id missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'processing_order_id'
  ) then raise exception 'online_order_requests.processing_order_id missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'processing_started_at'
  ) then raise exception 'online_order_requests.processing_started_at missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'online_order_requests' and column_name = 'processing_expires_at'
  ) then raise exception 'online_order_requests.processing_expires_at missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_order_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%PENDING%PROCESSING%ACCEPTED%REJECTED%'
  ) then raise exception 'online order request processing status constraint missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_order_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%DELIVERY%normalized_phone%delivery_address%'
  ) then raise exception 'delivery identity constraint missing'; end if;

  select count(*) into v_unique_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'online_order_requests'
    and indexdef ilike '%unique%shop_id%idempotency_key%';
  if v_unique_count <> 1 then
    raise exception 'shop-scoped online-order idempotency uniqueness missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'online_order_requests'
      and indexdef ilike '%accepted_order_id%'
      and indexdef ilike '%unique%'
  ) then raise exception 'accepted order one-to-one uniqueness missing'; end if;

  if to_regprocedure('public.list_tux_online_order_requests_v1(uuid,uuid,integer)') is null then
    raise exception 'list_tux_online_order_requests_v1 RPC missing';
  end if;
  if to_regprocedure('public.claim_tux_online_order_request_v1(uuid,uuid,uuid)') is null then
    raise exception 'claim_tux_online_order_request_v1 RPC missing';
  end if;
  if to_regprocedure('public.release_tux_online_order_request_claim_v1(uuid,uuid,uuid,uuid)') is null then
    raise exception 'release_tux_online_order_request_claim_v1 RPC missing';
  end if;
  if to_regprocedure('public.reject_tux_online_order_request_v1(uuid,uuid,uuid,uuid,text)') is null then
    raise exception 'reject_tux_online_order_request_v1 RPC missing';
  end if;
  if to_regprocedure('private.resolve_tux_online_order_request_from_order_v1()') is null then
    raise exception 'online-order final materialization resolver missing';
  end if;
  if not exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.orders'::regclass
      and not trigger.tgisinternal
      and trigger.tgname = 'orders_resolve_online_request_after_materialization'
  ) then
    raise exception 'online-order final materialization trigger missing';
  end if;

  select relrowsecurity into v_rls
  from pg_class
  where oid = 'public.online_order_requests'::regclass;
  if v_rls is not true then raise exception 'online_order_requests RLS is not enabled'; end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'online_order_requests'
      and (roles::text ilike '%anon%' or roles::text ilike '%authenticated%')
  ) then raise exception 'online_order_requests exposes a direct public/authenticated RLS policy'; end if;
end $$;
`;

const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(
    `Online-order intake migration assertions failed with exit code ${result.status ?? 'unknown'}.`,
  );
}
console.log('Online-order intake migration assertions passed.');
