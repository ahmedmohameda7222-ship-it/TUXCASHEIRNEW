import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for bootstrap provenance testing.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Bootstrap provenance testing refuses to use a non-loopback PostgreSQL database.');
}

const sql = `
do $$
declare
  v_nonce text := '11111111-1111-4111-8111-111111111111';
  v_claimed boolean;
begin
  delete from private.bootstrap_request_nonces where nonce = v_nonce;

  set local role service_role;
  select public.claim_tux_bootstrap_request_nonce(v_nonce, 300) into v_claimed;
  if not v_claimed then
    raise exception 'first bootstrap nonce claim should succeed';
  end if;

  select public.claim_tux_bootstrap_request_nonce(v_nonce, 300) into v_claimed;
  if v_claimed then
    raise exception 'replayed bootstrap nonce claim should be rejected';
  end if;
  reset role;

  update private.bootstrap_request_nonces
  set claimed_at = now() - interval '301 seconds'
  where nonce = v_nonce;

  set local role service_role;
  select public.claim_tux_bootstrap_request_nonce(v_nonce, 300) into v_claimed;
  if not v_claimed then
    raise exception 'expired bootstrap nonce should be reclaimable after retention';
  end if;
  reset role;
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
    `Bootstrap provenance behavior test failed with exit code ${result.status ?? 'unknown'}.`,
  );
}

process.stdout.write('Bootstrap request provenance behavior passed.\n');
