-- Rate-limit public worker-PIN bootstrap attempts before a browser is trusted as an Operations device.
-- Only the service role used inside the trusted Edge Function may call these helpers.

create table private.worker_pin_bootstrap_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

create index worker_pin_bootstrap_rate_limits_window_idx
  on private.worker_pin_bootstrap_rate_limits(window_started_at);

revoke all on private.worker_pin_bootstrap_rate_limits from public, anon, authenticated;

create or replace function public.claim_tux_worker_pin_bootstrap_attempt(
  p_rate_key text,
  p_max_attempts integer default 8,
  p_window_seconds integer default 900
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := now();
  v_window_started_at timestamptz;
  v_attempt_count integer;
  v_retry numeric;
begin
  if p_rate_key is null or p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'TUX_WORKER_PIN_RATE_KEY_INVALID';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'TUX_WORKER_PIN_RATE_LIMIT_INVALID';
  end if;
  if p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'TUX_WORKER_PIN_RATE_WINDOW_INVALID';
  end if;

  insert into private.worker_pin_bootstrap_rate_limits(rate_key, window_started_at, attempt_count)
  values (p_rate_key, v_now, 1)
  on conflict (rate_key) do update set
    window_started_at = case
      when private.worker_pin_bootstrap_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
        then v_now
      else private.worker_pin_bootstrap_rate_limits.window_started_at
    end,
    attempt_count = case
      when private.worker_pin_bootstrap_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
        then 1
      else private.worker_pin_bootstrap_rate_limits.attempt_count + 1
    end
  returning window_started_at, attempt_count
    into v_window_started_at, v_attempt_count;

  allowed := v_attempt_count <= p_max_attempts;
  if allowed then
    retry_after_seconds := 0;
  else
    v_retry := extract(
      epoch from (
        v_window_started_at + make_interval(secs => p_window_seconds) - v_now
      )
    );
    retry_after_seconds := greatest(1, ceil(v_retry)::integer);
  end if;
  return next;
end;
$$;

revoke all on function public.claim_tux_worker_pin_bootstrap_attempt(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_tux_worker_pin_bootstrap_attempt(text, integer, integer)
  to service_role;

create or replace function public.clear_tux_worker_pin_bootstrap_attempts(p_rate_key text)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  delete from private.worker_pin_bootstrap_rate_limits where rate_key = p_rate_key;
$$;

revoke all on function public.clear_tux_worker_pin_bootstrap_attempts(text)
  from public, anon, authenticated;
grant execute on function public.clear_tux_worker_pin_bootstrap_attempts(text)
  to service_role;
