import { createHash, timingSafeEqual } from 'node:crypto';

import { bootstrapOwner, OwnerBootstrapError } from '../../server/bootstrapOwner.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader,
  readJsonObject,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { AdminSupabaseClient } from '../../server/supabaseAdmin.js';

const EXPECTED_TOKEN_SHA256 =
  'cf778d0a4a373a358c52f9edaca1344d435e01b9aa1a2e168279d695fe208c55';
const CANONICAL_TUX_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function hasValidBootstrapToken(request: AdminRequest): boolean {
  const authorization = firstHeader(request.headers.authorization).trim();
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return false;

  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(EXPECTED_TOKEN_SHA256, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!hasValidBootstrapToken(request)) {
    sendJson(response, 401, { error: 'unauthorized' });
    return;
  }

  try {
    const body = await readJsonObject(request);
    const displayName = typeof body['displayName'] === 'string' ? body['displayName'].trim() : '';
    const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
    if (displayName !== 'Ahmed' || !/^\d{4,12}$/.test(pin)) {
      sendJson(response, 400, { error: 'invalid_bootstrap_request' });
      return;
    }

    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    const result = await bootstrapOwner(
      { displayName, pin },
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
