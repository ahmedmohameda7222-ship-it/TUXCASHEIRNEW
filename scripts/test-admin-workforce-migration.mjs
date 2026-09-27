import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = new URL('../supabase/migrations/20260910200000_admin_workforce.sql', import.meta.url);
assert.equal(fs.existsSync(path), true, 'Plan 6 Workforce migration must exist');
const sql = fs.readFileSync(path, 'utf8');

for (const [pattern, label] of [
  [/alter table public\.business_employees/i, 'business employee extension'],
  [/phone/i, 'employee phone'],
  [/hire_date/i, 'employee hire date'],
  [/credential_version/i, 'credential concurrency version'],
  [/create table public\.employee_worker_links/i, 'employee-worker links'],
  [/create table public\.employee_compensation/i, 'compensation history'],
  [/create table public\.employee_shifts/i, 'shifts'],
  [/create table public\.attendance_events/i, 'attendance events'],
  [/create table public\.attendance_corrections/i, 'attendance corrections'],
  [/create table public\.leave_requests/i, 'leave requests'],
  [/create table public\.staff_payment_records/i, 'staff payment records'],
  [/create table public\.staff_payment_expense_events/i, 'salary expense facts'],
  [/create table private\.admin_employee_pin_change_commands/i, 'private PIN command material'],
  [/create or replace function public\.assign_employee_to_shop_v1/i, 'shop assignment RPC'],
  [/create or replace function public\.link_employee_worker_v1/i, 'worker link RPC'],
  [/create or replace function public\.suspend_employee_v1/i, 'suspension RPC'],
  [/create or replace function public\.project_worker_session_attendance_v1/i, 'worker-session projection RPC'],
  [/create or replace function public\.correct_attendance_v1/i, 'attendance correction RPC'],
  [/create or replace function public\.record_staff_payment_v1/i, 'atomic staff payment RPC'],
  [/create or replace function public\.stage_employee_pin_change_v1/i, 'secret-safe PIN staging RPC'],
  [/create or replace function public\.apply_employee_pin_change_v1/i, 'atomic PIN apply RPC'],
  [/movement_type[^;]*STAFF_PAYMENT|STAFF_PAYMENT[^;]*movement_type/is, 'staff-payment finance movement'],
  [/staff_payment_expense_events/is, 'salary expense insert path'],
  [/worker_sessions/is, 'Operations session authority'],
  [/append_admin_audit_event_v1/is, 'Admin audit integration'],
  [/enable row level security/is, 'RLS'],
]) assert.match(sql, pattern, `Workforce migration missing ${label}`);

const publicTables = [
  'employee_worker_links',
  'employee_compensation',
  'employee_shifts',
  'attendance_events',
  'attendance_corrections',
  'leave_requests',
  'staff_payment_records',
  'staff_payment_expense_events',
];
for (const table of publicTables) {
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `missing RLS for ${table}`);
  assert.match(
    sql,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'),
    `missing browser revoke for ${table}`,
  );
}

assert.match(sql, /unique[^\n]*worker_id/i, 'one worker must not link to multiple employees');
assert.match(sql, /worker_session_id[^\n]*event_type|event_type[^\n]*worker_session_id/i, 'attendance projection must deduplicate worker-session facts');
assert.match(sql, /staff_payment_record_id[^\n]*(primary key|unique)|(primary key|unique)[^\n]*staff_payment_record_id/i, 'salary expense must be one-to-one with staff payment');
assert.match(sql, /unique[^\n]*command_id/i, 'staff payment command must be structurally idempotent');
assert.match(sql, /for update/is, 'sensitive Workforce commands must serialize mutable authority');
assert.doesNotMatch(sql, /delete\s+from\s+public\.business_employees/i, 'employees must not be hard deleted');
assert.doesNotMatch(sql, /update\s+public\.worker_sessions/i, 'Admin must not rewrite worker sessions');
assert.doesNotMatch(sql, /new_pin|raw_pin|plaintext_pin/i, 'migration must not persist raw PIN fields');

console.log('Admin Plan 6 Workforce migration source invariants passed.');
