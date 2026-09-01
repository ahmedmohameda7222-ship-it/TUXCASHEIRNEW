-- Prevent replay of trusted server-to-server worker-PIN bootstrap requests.
-- Only the service role used by the device-bootstrap Edge Function may claim nonces.

create table private.bootstrap_request_nonces (
  nonce text primary key check (
    nonce ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  claimed_at timestamptz not null default now()
);

create index bootstrap_request_nonces_claimed_at_idx
  on private.bootstrap_request_nonces(claimed_at);

revoke all on private.bootstrap_request_nonces from public, anon, authenticated;

create or replace function public.claim_tux_bootstrap_request_nonce(
  p_nonce text,
  p_retention_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_inserted integer;
  v_now timestamptz := now();
begin
  if p_nonce is null or p_nonce !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'TUX_BOOTSTRAP_NONCE_INVALID';
  end if;
  if p_retention_seconds < 300 or p_retention_seconds > 86400 then
    raise exception 'TUX_BOOTSTRAP_NONCE_RETENTION_INVALID';
  end if;

  delete from private.bootstrap_request_nonces
  where claimed_at <= v_now - make_interval(secs => p_retention_seconds);

  insert into private.bootstrap_request_nonces(nonce, claimed_at)
  values (lower(p_nonce), v_now)
  on conflict (nonce) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.claim_tux_bootstrap_request_nonce(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_tux_bootstrap_request_nonce(text, integer)
  to service_role;
