import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for PIN rate-limit testing.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('PIN rate-limit testing refuses to use a non-loopback PostgreSQL database.');
}

const sql = `
do $$
declare
  v_allowed boolean;
  v_retry integer;
  v_attempt_count integer;
  v_key text := repeat('a', 64);
begin
  delete from private.worker_pin_bootstrap_rate_limits where rate_key = v_key;

  set local role service_role;
  for i in 1..8 loop
    select allowed, retry_after_seconds into v_allowed, v_retry
    from public.claim_tux_worker_pin_bootstrap_attempt(v_key, 8, 900);
    if not v_allowed or v_retry <> 0 then
      raise exception 'attempt % should be allowed inside the configured ceiling', i;
    end if;
  end loop;

  select allowed, retry_after_seconds into v_allowed, v_retry
  from public.claim_tux_worker_pin_bootstrap_attempt(v_key, 8, 900);
  if v_allowed or v_retry <= 0 then
    raise exception 'attempt above the configured ceiling was not throttled';
  end if;

  select allowed into v_allowed
  from public.claim_tux_worker_pin_bootstrap_attempt(v_key, 8, 900);
  if v_allowed then
    raise exception 'throttling did not remain active for the current window';
  end if;
  reset role;

  update private.worker_pin_bootstrap_rate_limits
  set window_started_at = now() - interval '901 seconds'
  where rate_key = v_key;

  set local role service_role;
  select allowed, retry_after_seconds into v_allowed, v_retry
  from public.claim_tux_worker_pin_bootstrap_attempt(v_key, 8, 900);
  if not v_allowed or v_retry <> 0 then
    raise exception 'attempts did not resume after the legitimate window expired';
  end if;
  reset role;

  select attempt_count into v_attempt_count
  from private.worker_pin_bootstrap_rate_limits where rate_key = v_key;
  if v_attempt_count <> 1 then
    raise exception 'expired window did not restart at attempt one';
  end if;

  set local role service_role;
  perform public.clear_tux_worker_pin_bootstrap_attempts(v_key);
  select allowed into v_allowed
  from public.claim_tux_worker_pin_bootstrap_attempt(v_key, 8, 900);
  if not v_allowed then
    raise exception 'documented successful-auth clear did not restart the bucket';
  end if;
  reset role;

  select attempt_count into v_attempt_count
  from private.worker_pin_bootstrap_rate_limits where rate_key = v_key;
  if v_attempt_count <> 1 then
    raise exception 'successful-auth clear did not remove prior brute-force state';
  end if;
end $$;
`;

const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(`PIN rate-limit behavior test failed with exit code ${result.status ?? 'unknown'}.`);
}

process.stdout.write('Worker PIN rate-limit behavior passed.\n');
