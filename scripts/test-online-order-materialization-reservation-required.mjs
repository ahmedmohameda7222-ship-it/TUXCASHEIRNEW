import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error(
    'Online-order materialization reservation test refuses a non-loopback PostgreSQL database.',
  );
}

const sql = `
begin;

do $$
begin
  begin
    perform private.assert_tux_online_order_materialization_origin(
      '17666666-6666-4666-8666-666666666666'::uuid,
      '17111111-1111-4111-8111-111111111111'::uuid,
      jsonb_build_object(
        'table', 'orders',
        'row', jsonb_build_object(
          'id', '17bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'source', 'ONLINE'
        )
      )
    );
    raise exception 'UNRESERVED_ONLINE_MATERIALIZATION_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'UNRESERVED_ONLINE_MATERIALIZATION_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED' then
        raise;
      end if;
  end;
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
    `Online-order materialization reservation assertions failed with exit code ${result.status ?? 'unknown'}.`,
  );
}
console.log('Online-order materialization reservation assertions passed.');
