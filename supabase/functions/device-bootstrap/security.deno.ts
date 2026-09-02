const EDGE_ORIGIN = 'http://127.0.0.1:8000';
const SECRET = 'test-only-bootstrap-hmac-secret-with-more-than-32-bytes';
const DEVICE_ID = '22222222-2222-4222-8222-222222222221';
const RATE_KEY_A = 'a'.repeat(64);
const RATE_KEY_B = 'b'.repeat(64);

interface BootstrapBody {
  readonly pin: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly rateLimitKey: string;
}

interface RecordedCall {
  readonly pathname: string;
  readonly body: Record<string, unknown> | null;
}

function canonicalRequest(
  body: BootstrapBody,
  timestamp: number,
  nonce: string,
): string {
  return JSON.stringify([
    'tux-device-bootstrap:v1',
    timestamp,
    nonce,
    body.rateLimitKey.toLowerCase(),
    body.deviceId.toLowerCase(),
    body.deviceLabel,
    body.pin,
  ]);
}

async function signature(body: BootstrapBody, timestamp: number, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(canonicalRequest(body, timestamp, nonce)),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedHeaders(
  body: BootstrapBody,
  timestamp: number,
  nonce: string,
): Promise<Record<string, string>> {
  return {
    'content-type': 'application/json',
    'x-tux-bootstrap-timestamp': String(timestamp),
    'x-tux-bootstrap-nonce': nonce,
    'x-tux-bootstrap-signature': await signature(body, timestamp, nonce),
  };
}

async function postBootstrap(
  body: BootstrapBody,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Promise<Response> {
  const response = await fetch(EDGE_ORIGIN, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  await response.body?.cancel();
  return response;
}

async function waitForEdge(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(EDGE_ORIGIN);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('device-bootstrap Edge test process did not start');
}

Deno.test('device-bootstrap requires cryptographic Vercel provenance before rate limiting', async (test) => {
  const calls: RecordedCall[] = [];
  const claimedNonces = new Set<string>();
  const controller = new AbortController();
  const mock = Deno.serve(
    { hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen() {} },
    async (request) => {
      const url = new URL(request.url);
      let body: Record<string, unknown> | null = null;
      if (request.method !== 'GET') {
        try {
          const parsed: unknown = await request.json();
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        } catch {
          body = null;
        }
      }
      calls.push({ pathname: url.pathname, body });

      if (url.pathname.endsWith('/rest/v1/rpc/claim_tux_bootstrap_request_nonce')) {
        const nonce = typeof body?.['p_nonce'] === 'string' ? body['p_nonce'] : '';
        const first = nonce.length > 0 && !claimedNonces.has(nonce);
        if (first) claimedNonces.add(nonce);
        return new Response(JSON.stringify(first), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/rest/v1/rpc/claim_tux_worker_pin_bootstrap_attempt')) {
        return new Response(JSON.stringify([{ allowed: false, retry_after_seconds: 900 }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected_mock_call' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    },
  );

  const mockAddress = mock.addr as Deno.NetAddr;
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--allow-env',
      '--allow-net',
      '--config',
      'supabase/functions/device-bootstrap/deno.json',
      'supabase/functions/device-bootstrap/index.ts',
    ],
    env: {
      SUPABASE_URL: `http://127.0.0.1:${mockAddress.port}`,
      SUPABASE_ANON_KEY: 'publishable-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
      TUX_BOOTSTRAP_HMAC_SECRET: SECRET,
    },
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  try {
    await waitForEdge();
    const body: BootstrapBody = {
      pin: '1234',
      deviceId: DEVICE_ID,
      deviceLabel: 'Rotating label',
      rateLimitKey: RATE_KEY_A,
    };

    await test.step('unsigned direct callers cannot create a rate-limit bucket', async () => {
      calls.length = 0;
      const response = await postBootstrap(body);
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(`expected unsigned provenance rejection, received HTTP ${response.status}`);
      }
      if (calls.length !== 0) throw new Error('unsigned request reached Supabase before rejection');
    });

    await test.step('valid trusted proof reaches nonce claim and the trusted abuse bucket', async () => {
      calls.length = 0;
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = crypto.randomUUID();
      const response = await postBootstrap(body, await signedHeaders(body, timestamp, nonce));
      if (response.status !== 429) {
        throw new Error(`expected mocked rate limiter to throttle trusted request, received ${response.status}`);
      }
      if (!calls[0]?.pathname.endsWith('/rest/v1/rpc/claim_tux_bootstrap_request_nonce')) {
        throw new Error('trusted request did not claim its replay nonce first');
      }
      const rateCall = calls.find((call) =>
        call.pathname.endsWith('/rest/v1/rpc/claim_tux_worker_pin_bootstrap_attempt'),
      );
      if (rateCall?.body?.['p_rate_key'] !== RATE_KEY_A) {
        throw new Error('trusted request did not use the signed abuse identity');
      }
    });

    await test.step('tampering with the abuse identity after signing is rejected', async () => {
      calls.length = 0;
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = crypto.randomUUID();
      const headers = await signedHeaders(body, timestamp, nonce);
      const tampered = { ...body, rateLimitKey: RATE_KEY_B };
      const response = await postBootstrap(tampered, headers);
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(`expected tampered proof rejection, received HTTP ${response.status}`);
      }
      if (calls.length !== 0) throw new Error('tampered request reached Supabase before rejection');
    });

    await test.step('stale signed requests are rejected before Supabase', async () => {
      calls.length = 0;
      const timestamp = Math.floor(Date.now() / 1000) - 600;
      const nonce = crypto.randomUUID();
      const response = await postBootstrap(body, await signedHeaders(body, timestamp, nonce));
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(`expected stale proof rejection, received HTTP ${response.status}`);
      }
      if (calls.length !== 0) throw new Error('stale request reached Supabase before rejection');
    });

    await test.step('replaying the same signed request is rejected after the first claim', async () => {
      calls.length = 0;
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = crypto.randomUUID();
      const headers = await signedHeaders(body, timestamp, nonce);
      const first = await postBootstrap(body, headers);
      if (first.status !== 429) {
        throw new Error(`expected first trusted request to reach limiter, got ${first.status}`);
      }
      const second = await postBootstrap(body, headers);
      if (second.status !== 409) {
        throw new Error(`expected replay rejection, received HTTP ${second.status}`);
      }
      const nonceClaims = calls.filter((call) =>
        call.pathname.endsWith('/rest/v1/rpc/claim_tux_bootstrap_request_nonce'),
      );
      const rateClaims = calls.filter((call) =>
        call.pathname.endsWith('/rest/v1/rpc/claim_tux_worker_pin_bootstrap_attempt'),
      );
      if (nonceClaims.length !== 2 || rateClaims.length !== 1) {
        throw new Error('replayed proof was not stopped before a second rate-limit claim');
      }
    });
  } finally {
    child.kill('SIGTERM');
    await child.status;
    controller.abort();
    await mock.finished;
  }
});
