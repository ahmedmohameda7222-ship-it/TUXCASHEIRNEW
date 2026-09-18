import fs from 'node:fs';

const migrationDir = 'supabase/migrations';
const sql = fs
  .readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => fs.readFileSync(`${migrationDir}/${name}`, 'utf8'))
  .join('\n')
  .toLowerCase();

if (!sql.includes('on conflict (business_id, command_id) do nothing')) {
  throw new Error('Plan 3 request creation must converge concurrent command_id inserts with ON CONFLICT');
}

if (!sql.includes('admin_plan3_review_hardening')) {
  throw new Error('Plan 3 review hardening migration marker missing');
}

console.log('Admin Plan 3 review hardening static invariant passed.');
