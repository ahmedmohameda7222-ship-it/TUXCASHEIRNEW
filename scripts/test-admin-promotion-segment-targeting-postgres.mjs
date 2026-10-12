import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = '20261012102000_admin_promotion_segment_targeting.sql';
if (!existsSync(resolve('supabase/migrations', migration)))
  throw new Error('Missing provisioning migration');
const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Isolated worker provisioning test skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing to mutate non-loopback PostgreSQL');
}
function sql(query, label) {
  const result = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(label + ': ' + (result.stderr || result.stdout));
  }
  return result.stdout.trim();
}
function file(path) {
  const result = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(path + ': ' + (result.stderr || result.stdout));
}
function call(actor, employee, shop, command) {
  return JSON.parse(
    sql(
      "select public.provision_employee_operations_worker_v1('" +
        actor +
        "','" +
        employee +
        "','" +
        shop +
        "','" +
        command +
        "')::text",
      'provision RPC',
    ),
  );
}
function deny(response, code) {
  if (response.ok !== false || response.code !== code) {
    throw new Error('Expected ' + code + ', received: ' + JSON.stringify(response));
  }
}

// The preceding loyalty behavior script loads the Plan 5 baseline, not future
// corrections. Apply this exact forward-only migration to the isolated fixture
// before asserting targeting behavior; never run it against a remote database.
file(resolve('supabase/migrations', migration));

const B = '61000000-0000-4000-8000-000000000001';
const S = '62000000-0000-4000-8000-000000000001';
const E = '63000000-0000-4000-8000-000000000001';
const W = '64000000-0000-4000-8000-000000000001';
const D = '65000000-0000-4000-8000-000000000001';
const T = '66000000-0000-4000-8000-000000000001';
const C = '67000000-0000-4000-8000-000000000001';
const C2 = '67000000-0000-4000-8000-000000000002';
const CONTACT = '68000000-0000-4000-8000-000000000001';
const ZONE = '68000000-0000-4000-8000-000000000002';
const P = '69000000-0000-4000-8000-000000000001';
const P2 = '69000000-0000-4000-8000-000000000002';

const setup = [
  "insert into public.businesses(id,name) values ('" + B + "','Promotion Target Tenant');",
  "insert into public.shops(id,name,active) values ('" + S + "','Target Shop',true);",
  "insert into public.business_shops(business_id,shop_id) values ('" + B + "','" + S + "');",
  "insert into public.business_employees(id,business_id,display_name,role,active) values ('" +
    E + "','" + B + "','Owner','OWNER',true);",
  "insert into public.workers(id,shop_id,display_name,pin_hash,active) values ('" +
    W + "','" + S + "','Worker','test-only',true);",
  "insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id,last_allocated_display_order_no) values ('" +
    D + "','" + S + "','OPEN',now()-interval '40 days','" + W + "',1);",
  "insert into public.order_types(id,shop_id,name,behavior,active,sort_order) values ('" +
    T + "','" + S + "','Delivery','DELIVERY',true,0);",
  "insert into public.delivery_zones(id,shop_id,name,fee_minor,active,sort_order) values ('" +
    ZONE + "','" + S + "','Nearby',0,true,0);",
  "insert into public.business_customers(id,business_id,normalized_phone,display_name) values ('" +
    C + "','" + B + "','+201000000011','Returning Customer'),('" +
    C2 + "','" + B + "','+201000000022','Unmatched Customer');",
  "insert into public.customer_contacts(id,shop_id,normalized_phone,display_phone,name,canonical_customer_id) values ('" +
    CONTACT + "','" + S + "','+201000000011','+201000000011','Returning Customer','" + C + "');",
];
sql(setup.join('\n'), 'isolated promotion customer fixtures');
const canonicalLink = sql(
  "select count(*) from public.customer_shop_links where business_id='" + B +
    "' and shop_id='" + S + "' and canonical_customer_id='" + C +
    "' and legacy_customer_contact_id='" + CONTACT + "'",
  'automatic customer-shop canonical linkage',
);
if (canonicalLink !== '1') throw new Error('Customer contact did not create exactly one canonical link');

function promotion(id, segments) {
  const array = 'ARRAY[' + segments.map((v) => "'" + v + "'").join(',') + ']::text[]';
  return "insert into public.promotion_rules(id,business_id,name,kind,active,fixed_discount_minor," +
    "minimum_order_minor,shop_ids,channel,segment_targets,updated_by_employee_id) values ('" +
    id + "','" + B + "','Target Offer','FIXED',true,150,0,ARRAY['" +
    S + "'::uuid],'BOTH'," + array + ",'" + E + "')";
}
sql(promotion(P, ['Returning']) + ';' + promotion(P2, []) + ';', 'targeted and legacy unrestricted offers');
const eligible = (customer, segment) =>
  sql("select private.customer_matches_promotion_segments_v1('" +
    B + "','" + customer + "',ARRAY['" + segment + "']::text[])",
    'canonical customer segmentation');
if (eligible(C, 'Returning') !== 'f') throw new Error('Zero-order customer must not be Returning');
if (eligible(C, 'New') !== 't') throw new Error('Zero-order customer should be New');

function reserve(id, customer, channel, intent) {
  const identity = customer === null ? 'null::uuid' : "'" + customer + "'::uuid";
  return JSON.parse(sql("select public.reserve_order_rewards_v1('" +
    B + "','" + S + "'," + identity + ",'" + intent + "','" + id +
    "',0,'" + channel + "',1000,'{}'::uuid[],'{}'::uuid[],now())::text",
    'trusted ' + channel + ' segment reservation'));
}
function mustDeny(result, label) {
  if (result.ok !== false || result.code !== 'reward_not_available') {
    throw new Error(label + ' bypassed segment targeting: ' + JSON.stringify(result));
  }
}
mustDeny(reserve(P, C, 'POS', 'before-orders'), 'Customer outside selected segment');
mustDeny(reserve(P, null, 'POS', 'anonymous-targeted'), 'Anonymous checkout');
mustDeny(reserve(P, C2, 'ONLINE', 'unknown-segment'), 'Unknown customer membership');
const unrestricted = reserve(P2, null, 'ONLINE', 'legacy-public-promo');
if (!unrestricted.ok) throw new Error('Unrestricted legacy promo was broken: ' + JSON.stringify(unrestricted));

const sqlOrders = "insert into public.orders(" +
  "id,shop_id,business_day_id,display_order_no,idempotency_key,source,status," +
  "operator_worker_id,operator_name_snapshot,order_type_id,order_type_label_snapshot," +
  "order_type_behavior_snapshot,customer_contact_id,customer_name_snapshot," +
  "normalized_phone_snapshot,address_snapshot,delivery_zone_id,delivery_zone_label_snapshot," +
  "items_subtotal_minor,discount_minor,total_minor,created_at,updated_at) " +
  "select gen_random_uuid(),'" + S + "','" + D + "',i,'segment-pos-'||i,'POS','DONE','" +
  W + "','Worker','" + T + "','Delivery','DELIVERY','" + CONTACT +
  "','Returning Customer','+201000000011','Fixture address','" + ZONE +
  "','Nearby',10000,0,10000," +
  "now()-interval '31 days',now()-interval '31 days' from generate_series(1,2) i";
sql(sqlOrders, 'trusted paid order history');
if (eligible(C, 'Returning') !== 't') throw new Error('Canonical customer membership did not update');
if (eligible(C, 'Inactive 30 Days') !== 't') throw new Error('Inactive membership ignored server clock');
if (eligible(C, 'VIP') !== 'f') throw new Error('Insufficient VIP tenure unexpectedly eligible');

const pos = reserve(P, C, 'POS', 'pos-segment-eligible');
if (!pos.ok || !pos.snapshot?.promotion?.segmentTargets?.includes('Returning')) {
  throw new Error('POS reservation or immutable segment snapshot failed: ' + JSON.stringify(pos));
}
const online = reserve(P, C, 'ONLINE', 'online-segment-eligible');
if (!online.ok || !online.snapshot?.promotion?.segmentTargets?.includes('Returning')) {
  throw new Error('ONLINE promotion segment parity failed: ' + JSON.stringify(online));
}
const replay = reserve(P, C, 'POS', 'pos-segment-eligible');
if (!replay.ok || replay.replayed !== true || replay.reservationId !== pos.reservationId) {
  throw new Error('Targeted promotion command replay was not idempotent: ' + JSON.stringify(replay));
}

sql("update public.promotion_rules set segment_targets=ARRAY['VIP']::text[],version=version+1 " +
  "where id='" + P + "'", 'change eligibility policy');
mustDeny(reserve(P, C, 'POS', 'after-membership-change'), 'Stale client membership');
const stillReplayed = reserve(P, C, 'POS', 'pos-segment-eligible');
if (!stillReplayed.ok || !stillReplayed.replayed) {
  throw new Error('Immutable committed reservation must replay its original attribution');
}

const signature = 'public.upsert_admin_promotion_v2(uuid,uuid,uuid,text,boolean,text,integer,bigint,uuid,' +
  'timestamptz,timestamptz,bigint,uuid[],text,uuid[],uuid[],bigint,bigint,text,bigint,text,text[])';
for (const role of ['anon', 'authenticated']) {
  if (sql("select has_function_privilege('" + role + "','" + signature + "','EXECUTE')",
    role + ' promotion write privileges') !== 'f') {
    throw new Error(role + ' must not execute the promotion v2 writer');
  }
}
if (sql("select has_function_privilege('service_role','" + signature + "','EXECUTE')",
  'trusted promotion write privilege') !== 't') {
  throw new Error('service_role cannot execute the promotion v2 writer');
}
console.log('Canonical automatic-segment POS/ONLINE promotion behavior passed.');
