import { createHash, timingSafeEqual } from 'node:crypto';

import { bootstrapOwner, OwnerBootstrapError } from '../../server/bootstrapOwner.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { AdminSupabaseClient } from '../../server/supabaseAdmin.js';

const EXPECTED_TOKEN_SHA256 =
  '54678cf96cfdb57c0ef136fbb690113f97b2df2c49bf8644ed44e4a06629b80f';
const CANONICAL_TUX_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readBootstrapToken(request: AdminRequest): string {
  const requestUrl = new URL(request.url ?? '/', 'https://bootstrap.invalid');
  return requestUrl.searchParams.get('t')?.trim() ?? '';
}

function hasValidBootstrapToken(token: string): boolean {
  if (!token) return false;
  const actual = Buffer.from(sha256Hex(token), 'hex');
  const expected = Buffer.from(EXPECTED_TOKEN_SHA256, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveOwnerPin(token: string): string {
  const digest = sha256Hex(`tux-admin-bootstrap-pin:${token}`);
  return String(Number.parseInt(digest.slice(0, 8), 16) % 10_000).padStart(4, '0');
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  const token = readBootstrapToken(request);
  if (!hasValidBootstrapToken(token)) {
    sendJson(response, 401, { error: 'unauthorized' });
    return;
  }

  try {
    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    const result = await bootstrapOwner(
      { displayName: 'Ahmed', pin: deriveOwnerPin(token) },
      {
        pinLookupSecret: env.pinLookupSecret,
        async createOwner(input) {
          return client.rpc<string>('bootstrap_tux_admin_owner_v1', {
            p_business_id: CANONICAL_TUX_BUSINESS_ID,
            p_display_name: input.displayName,
            p_pin_lookup_hash: input.pinLookupHash,
            p_pin_hash: input.pinHash,
          });
        },
      },
    );

    sendJson(response, 201, { ok: true, employeeId: result.employeeId });
  } catch (error) {
    if (error instanceof OwnerBootstrapError) {
      sendJson(response, 409, { error: error.code });
      return;
    }
    sendJson(response, 500, { error: 'bootstrap_failed' });
  }
}
