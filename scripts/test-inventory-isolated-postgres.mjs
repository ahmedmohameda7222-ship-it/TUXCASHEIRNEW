import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable local TEST_DATABASE_URL is required.');
if (!new Set(['127.0.0.1','localhost','::1']).has(new URL(databaseUrl).hostname)) {
  throw new Error('Inventory PostgreSQL acceptance refuses non-loopback databases.');
}
function execute(args, purpose, mustFail = false, expectedError = '') {
  const result = spawnSync('psql', [databaseUrl,'-X','-q','-v','ON_ERROR_STOP=1',...args], {
    encoding:'utf8',maxBuffer: 4 * 1024 * 1024
  });
  const success = result.status === 0;
  if (success === mustFail || (mustFail && !success && !result.stderr.includes(expectedError))) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error('Unexpected outcome in ' + purpose + ' (exit ' + result.status + ')');
  }
  return result.stdout.trim();
}
const query = (text,purpose='Query') => execute(['-At','-c',text],purpose);
const reject = (text,needle,purpose) => execute(['-c',text],purpose,true,needle);
function literal(value) {
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    return "'" + JSON.stringify(value).replaceAll("'","''") + "'::jsonb";
  }
  return "'" + String(value).replaceAll("'","''") + "'";
}
function call(name,...args) {
  return JSON.parse(query('select (public.'+name+'('+args.map(literal).join(',')+'))::text;',name));
}
function eq(actual,expected,description) {
  if (actual !== expected) throw new Error(description+': expected '+expected+', got '+actual);
}
function verify(condition,description) {if (!condition) throw new Error(description);}
const S='20000000-0000-4000-8000-000000000001';
const D='20000000-0000-4000-8000-000000000002';
const E='30000000-0000-4000-8000-000000000001';
const FOREIGN='30000000-0000-4000-8000-000000000002';
const A='50000000-0000-4000-8000-000000000001';
const B='50000000-0000-4000-8000-000000000002';
const WRONG='50000000-0000-4000-8000-000000000003';

execute(['-f',resolve('scripts/fixtures/inventory-isolated-postgres.sql')],'Reset disposable database');
const migrationPaths=[
 '20261025170000_inventory_offshift_quiescence.sql',
 '20261025171000_inventory_transfer_master_identity.sql',
 '20261025172000_inventory_transfer_cancel_compensation.sql',
 '20261025173000_inventory_stocktake_draft_recovery.sql',
];
for (const path of migrationPaths) {
  execute(['-f',resolve('supabase/migrations',path)],'Apply '+path);
}
console.log('Inventory acceptance: all 4 migrations executed in isolated PostgreSQL fixture.');

function send(items,command,source=S,destination=D,actor=E) {
  return call('send_stock_transfer_v1',actor,source,destination,items,command);
}
function receive(id,command,actor=E) {return call('receive_stock_transfer_v1',actor,id,command);}
function cancel(id,command,actor=E) {return call('cancel_stock_transfer_v1',actor,id,command);}
function balance(shop,item) {
  return Number(query('select on_hand_micros from private.inventory_balance_v1('+literal(shop)+','+literal(item)+')','Current balance'));
}
const line=[{inventoryItemId:A,quantityMicros:2000000}];
const first=send(line,'test-transfer-send-1');
verify(first.ok===true && first.idempotentReplay===false && first.transferId,'Master-based transfer send must succeed for different item names.');
eq(balance(S,A),8000000,'Source debited once');
eq(balance(D,B),0,'Destination not credited before receive');
verify(send(line,'test-transfer-send-1').idempotentReplay===true,'Identical send replays idempotently');
eq(send([{inventoryItemId:A,quantityMicros:1000000}],'test-transfer-send-1').code,
  'idempotency_conflict','Altered payload with retained command ID must conflict');
eq(balance(S,A),8000000,'Altered replay did not debit');
verify(receive(first.transferId,'test-transfer-receive-1').ok===true,'SENT transfer can be received');
eq(balance(D,B),2000000,'Destination receipt credits mapped item');
verify(receive(first.transferId,'test-transfer-receive-1').idempotentReplay===true,'Duplicate receive must replay');
eq(balance(D,B),2000000,'Destination not double credited');
eq(cancel(first.transferId,'invalid-cancel-received').code,
  'transfer_not_cancellable','RECEIVED transfer cannot be cancelled');
eq(send([{inventoryItemId:WRONG,quantityMicros:1000000}],'name-trap').code,
  'destination_inventory_master_mapping_required','Identically named but different master is NOT compatible');
eq(balance(S,WRONG),4000000,'Same-name transfer denial preserves stock');

const second=send([{inventoryItemId:A,quantityMicros:1000000}],'test-transfer-send-2');
verify(second.ok && second.transferId,'Second send succeeded');
eq(balance(S,A),7000000,'Second send source debit');
verify(cancel(second.transferId,'test-transfer-cancel').ok,'SENT transfer may be cancelled');
eq(balance(S,A),8000000,'Cancellation exactly restores source stock');
verify(cancel(second.transferId,'test-transfer-cancel').idempotentReplay===true,'Cancel retry no duplicate movement');
eq(cancel(second.transferId,'different-command-id').code,
  'idempotency_conflict','Changing cancel command after posting blocked');
eq(receive(second.transferId,'late-receive').code,
  'transfer_not_receivable','Cancelled transfer cannot be received');
eq(query("select count(*) from public.inventory_movements where movement_type='TRANSFER_CANCELLED' and compensates_movement_id is not null"),
  '1','Exactly one auditable compensating ledger entry');
reject('select public.send_stock_transfer_v1('+
  [FOREIGN,S,D,JSON.stringify(line),'cross-business-command'].map(literal).join(',')+')',
  'authority_scope_forbidden','Cross-business actor cannot send');

for(const signature of [
 'read_admin_stocktake_quiescence_v1(uuid,uuid)',
 'send_stock_transfer_v1(uuid,uuid,uuid,jsonb,text)',
 'cancel_stock_transfer_v1(uuid,uuid,text)'
]){
 const got=query("select has_function_privilege('anon','public."+signature+"','EXECUTE')::text || ',' || has_function_privilege('service_role','public."+signature+"','EXECUTE')::text");
 eq(got,'false,true','Service role only privilege for '+signature);
}
console.log('Inventory acceptance: master identity, name trap, debit, receive, replay, cancel compensation, cross-business and RPC grants PASSED.');

function eligible() {return call('read_admin_stocktake_quiescence_v1',E,S);}
verify(eligible().allowed===true,'Idle shop eligible without imposing financial day closure');
const activeSession=query("insert into public.worker_sessions(shop_id) values("+literal(S)+") returning id");
eq(eligible().code,'active_worker_session','Active worker session blocks physical count');
reject('insert into public.stocktakes(id,shop_id,created_by_employee_id,status,command_id) values(gen_random_uuid(),'+literal(S)+','+literal(E)+",'DRAFT','blocked-active')",
  'stocktake_requires_off_shift','Database BEGIN blocked by worker session');
query("update public.worker_sessions set ended_at=now() where id="+literal(activeSession),'End shift');
const unfinishedOrder=query("insert into public.orders(shop_id,status) values("+literal(S)+",'OPEN') returning id");
eq(eligible().code,'unfinished_orders','Unfinished order blocks stocktake');
reject('insert into public.stocktakes(id,shop_id,created_by_employee_id,status,command_id) values(gen_random_uuid(),'+literal(S)+','+literal(E)+",'DRAFT','blocked-order')",
  'stocktake_requires_off_shift','Database BEGIN blocked by pending order');
query("update public.orders set status='DONE' where id="+literal(unfinishedOrder));
verify(eligible().allowed===true,'After shift and finalized orders count may begin');
const stocktake1='60000000-0000-4000-8000-000000000001';
const stocktake2='60000000-0000-4000-8000-000000000002';
function beginCount(id){
 query("insert into public.stocktakes(id,shop_id,created_by_employee_id,status,command_id) values("+
  [id,S,E,'DRAFT','begin-'+id].map(literal).join(',')+")",'Begin physical stocktake');
 const amount=balance(S,A);
 query("insert into public.stocktake_lines(stocktake_id,inventory_item_id,snapshot_on_hand_micros,snapshot_reserved_micros,posting_expected_on_hand_micros,unit_cost_minor) values("+
  literal(id)+','+literal(A)+','+amount+',0,'+amount+',1250)','Count snapshot');
}
function post(id,command) {
 return "update public.stocktakes set status='POSTED',post_command_id="+literal(command)+
   ",posted_at=now() where id="+literal(id);
}
beginCount(stocktake1);
const reopened=query("insert into public.worker_sessions(shop_id) values("+literal(S)+") returning id");
reject(post(stocktake1,'post-1'),'stocktake_requires_off_shift','Database POST blocked on live shift');
query("update public.worker_sessions set ended_at=now() where id="+literal(reopened));
query("insert into public.inventory_movements(id,shop_id,inventory_item_id,movement_type,quantity_delta_micros,reserved_delta_micros,idempotency_key,admin_employee_id,source_kind) values(gen_random_uuid(),"+
  literal(S)+','+literal(A)+",'PURCHASE_RECEIPT',1000000,0,'late-stock-receipt',"+literal(E)+",'ADMIN')",'Delayed stock movement');
reject(post(stocktake1,'post-1'),'stocktake_snapshot_stale','Stale count must not write after ledger moved');
eq(query("select status from public.stocktakes where id="+literal(stocktake1)),'DRAFT','Rejected posting stays DRAFT');
beginCount(stocktake2);
query(post(stocktake2,'post-2'),'Fresh after-shift posting');
eq(query("select status from public.stocktakes where id="+literal(stocktake2)),'POSTED','Fresh count finalizes');
console.log('Inventory acceptance: active-shift begin/post deny; open order deny; stale ledger rollback; clean after-shift posting PASSED.');


// New persisted count session and draft write acceptance, after prior core guards.
const stocktake3='60000000-0000-4000-8000-000000000003';
beginCount(stocktake3);
const sessions=call('read_admin_stocktake_sessions_v1',E,S);
verify(sessions.ok && Array.isArray(sessions.sessions),'Authorized shop stocktake sessions readable');
verify(sessions.sessions.some(x=>x.stocktakeId===stocktake3&&x.status==='DRAFT'),'Refresh restores actual server DRAFT');
verify(sessions.sessions.find(x=>x.stocktakeId===stocktake1)?.stale===true,'Delayed receipt visibly marks stale DRAFT');
const saved=[{inventoryItemId:A,actualCountMicros:9000000}];
let result=call('save_admin_stocktake_draft_v1',E,S,stocktake3,0,saved,'draft-save-1');
verify(result.ok && result.draftRevision===1,'Draft save increments optimistic version');
verify(call('save_admin_stocktake_draft_v1',E,S,stocktake3,0,saved,'draft-save-1').idempotentReplay===true,
 'Exact draft save command retry idempotent');
eq(call('save_admin_stocktake_draft_v1',E,S,stocktake3,0,
 [{inventoryItemId:A,actualCountMicros:5000000}],'draft-save-1').code,
 'idempotency_conflict','Altered same-command draft content denied');
eq(call('save_admin_stocktake_draft_v1',E,S,stocktake3,0,saved,'draft-save-stale').code,
 'stale_version','Old revision cannot overwrite later saved count');
const resumed=call('read_admin_stocktake_sessions_v1',E,S).sessions.find(x=>x.stocktakeId===stocktake3);
eq(Number(resumed.lines[0].actualCountMicros),9000000,'Reload restores saved entered count');
const openWorker=query("insert into public.worker_sessions(shop_id) values("+literal(S)+") returning id");
eq(call('save_admin_stocktake_draft_v1',E,S,stocktake3,1,saved,'draft-save-trading').code,
 'stocktake_requires_off_shift','Draft entry prohibited when shift reopened');
query("update public.worker_sessions set ended_at=now() where id="+literal(openWorker));
const newSaved=[{inventoryItemId:A,actualCountMicros:8000000}];
result=call('save_admin_stocktake_draft_v1',E,S,stocktake3,1,newSaved,'draft-save-2');
verify(result.ok && result.draftRevision===2,'Legitimate second save after shift');
const cancelled=call('cancel_admin_stocktake_draft_v1',E,S,stocktake3,'draft-cancel-1');
verify(cancelled.ok && !cancelled.idempotentReplay,'Discard open DRAFT without stock movement');
verify(call('cancel_admin_stocktake_draft_v1',E,S,stocktake3,'draft-cancel-1').idempotentReplay,
 'Exact cancellation replay idempotent');
eq(call('cancel_admin_stocktake_draft_v1',E,S,stocktake3,'changed-cancel').code,
 'idempotency_conflict','Changed cancel key rejected');
eq(call('save_admin_stocktake_draft_v1',E,S,stocktake3,2,newSaved,'save-after-cancel').code,
 'stocktake_not_editable','CANCELLED draft cannot be saved');
eq(Number(query("select count(*) from public.inventory_movements where command_id like 'draft-%'")),
 0,'No ledger movement from draft save/cancel');
reject("select public.read_admin_stocktake_sessions_v1("+literal(FOREIGN)+","+literal(S)+")",
 'authority_scope_forbidden','Foreign employee denied persisted count history');
for(const signature of [
 'read_admin_stocktake_sessions_v1(uuid,uuid)',
 'save_admin_stocktake_draft_v1(uuid,uuid,uuid,bigint,jsonb,text)',
 'cancel_admin_stocktake_draft_v1(uuid,uuid,uuid,text)'
]) {
 const grants=query("select has_function_privilege('anon','public."+signature+"','EXECUTE')::text || ',' || has_function_privilege('service_role','public."+signature+"','EXECUTE')::text");
 eq(grants,'false,true','Draft RPC BFF service boundary: '+signature);
}
console.log('Inventory acceptance: authorized persisted session resume, exact saved counts, version conflict, off-shift save, cancel, replay and grants PASSED.');
