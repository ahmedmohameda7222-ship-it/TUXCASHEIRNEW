import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
  isAdminRole,
  type AdminPermission,
  type AdminRole,
  type AdminSessionPrincipal,
} from '@tux/admin-contracts';

import type { AdminServerEnv } from './env';
import {
  claimAdminPinAttempt,
  clearAdminPinAttempts,
  deriveAdminRateKey,
  type AdminClientFingerprint,
  type AdminPinRateLimitRpc,
} from './loginRateLimit';
import { pinLookupHash, verifyPin } from './pin';
import {
  createSessionMaterial,
  csrfMatches,
  sha256Hex,
  type AdminSessionMaterial,
} from './session';
import { AdminSupabaseClient } from './supabaseAdmin';

export type AdminEmployeeRow = {
  id: string;
  business_id: string;
  display_name: string;
  role: string;
  pin_hash: string | null;
  active: boolean;
};

export type AdminSessionRow = {
  id: string;
  business_id: string;
  employee_id: string;
  csrf_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  reauthenticated_at: string | null;
};

export type AdminSessionContext = {
  session: AdminSessionRow;
  employee: AdminEmployeeRow;
  principal: AdminSessionPrincipal;
};

export class AdminAuthError extends Error {
  constructor(
    readonly code:
      | 'invalid_pin'
      | 'session_required'
      | 'session_expired'
      | 'csrf_invalid'
      | 'employee_inactive'
      | 'authorization_state_invalid',
    readonly status: number,
  ) {
    super(code);
    this.name = 'AdminAuthError';
  }
}

function query(entries: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams(entries);
}

function requireRole(role: string): AdminRole {
  if (!isAdminRole(role)) throw new AdminAuthError('authorization_state_invalid', 500);
  return role;
}

async function resolvePrincipal(
  employee: AdminEmployeeRow,
  client: AdminSupabaseClient,
): Promise<AdminSessionPrincipal> {
  const role = requireRole(employee.role);
  const shopIds = new Set<string>();

  if (role === 'OWNER') {
    const rows = await client.select<Array<{ shop_id: string }>>(
      'business_shops',
      query({ select: 'shop_id', business_id: `eq.${employee.business_id}` }),
    );
    for (const row of rows) shopIds.add(row.shop_id);
  } else {
    const rows = await client.select<Array<{ shop_id: string }>>(
      'employee_shop_assignments',
      query({
        select: 'shop_id',
        business_id: `eq.${employee.business_id}`,
        employee_id: `eq.${employee.id}`,
      }),
    );
    for (const row of rows) shopIds.add(row.shop_id);
  }

  const granted = new Set<AdminPermission>();
  if (role === 'OWNER') {
    for (const permission of ADMIN_PERMISSIONS) granted.add(permission);
  } else {
    const presetRows = await client.select<Array<{ permission_key: string }>>(
      'admin_role_permissions',
      query({
        select: 'permission_key',
        business_id: `eq.${employee.business_id}`,
        role: `eq.${role}`,
      }),
    );
    for (const row of presetRows) {
      if (isAdminPermission(row.permission_key)) granted.add(row.permission_key);
    }

    const overrides = await client.select<
      Array<{ permission_key: string; effect: 'ALLOW' | 'DENY' }>
    >(
      'admin_employee_permissions',
      query({
        select: 'permission_key,effect',
        business_id: `eq.${employee.business_id}`,
        employee_id: `eq.${employee.id}`,
      }),
    );
    for (const override of overrides) {
      if (!isAdminPermission(override.permission_key)) continue;
      if (override.effect === 'ALLOW') granted.add(override.permission_key);
      else granted.delete(override.permission_key);
    }
  }

  return {
    employeeId: employee.id,
    businessId: employee.business_id,
    role,
    permissions: ADMIN_PERMISSIONS.filter((permission) => granted.has(permission)),
    shopIds: [...shopIds],
  };
}

function rateLimitRpc(client: AdminSupabaseClient): AdminPinRateLimitRpc {
  return {
    async claim(rateKey) {
      const rows = await client.rpc<Array<{ allowed: boolean; retry_after_seconds: number }>>(
        'claim_tux_admin_pin_attempt',
        { p_rate_key: rateKey, p_max_attempts: 8, p_window_seconds: 900 },
      );
      const row = rows[0];
      if (!row) throw new Error('admin_rate_limit_protocol_error');
      return { allowed: row.allowed === true, retryAfterSeconds: row.retry_after_seconds };
    },
    async clear(rateKey) {
      await client.rpc<unknown>('clear_tux_admin_pin_attempts', { p_rate_key: rateKey });
    },
  };
}

export async function loginAdmin(
  pin: string,
  fingerprint: AdminClientFingerprint,
  client: AdminSupabaseClient,
  env: AdminServerEnv,
  now = new Date(),
): Promise<{
  material: AdminSessionMaterial;
  principal: AdminSessionPrincipal;
}> {
  const rateKey = await deriveAdminRateKey(fingerprint, env.rateLimitSecret);
  const limiter = rateLimitRpc(client);
  await claimAdminPinAttempt(rateKey, limiter);

  const lookupHash = await pinLookupHash(pin, env.pinLookupSecret);
  const employees = await client.select<AdminEmployeeRow[]>(
    'business_employees',
    query({
      select: 'id,business_id,display_name,role,pin_hash,active',
      pin_lookup_hash: `eq.${lookupHash}`,
      active: 'eq.true',
      limit: '2',
    }),
  );
  const employee = employees.length === 1 ? employees[0] : undefined;
  if (!employee?.pin_hash || !(await verifyPin(pin, employee.pin_hash))) {
    throw new AdminAuthError('invalid_pin', 401);
  }

  const principal = await resolvePrincipal(employee, client);
  const material = createSessionMaterial(now, env.sessionTtlSeconds);
  await client.insert<unknown>('admin_sessions', {
    business_id: employee.business_id,
    employee_id: employee.id,
    token_hash: material.tokenHash,
    csrf_token_hash: material.csrfTokenHash,
    expires_at: material.expiresAt.toISOString(),
  });
  await clearAdminPinAttempts(rateKey, limiter);
  return { material, principal };
}

export async function loadAdminSession(
  token: string,
  client: AdminSupabaseClient,
  now = new Date(),
): Promise<AdminSessionContext> {
  const tokenHash = sha256Hex(token);
  const sessions = await client.select<AdminSessionRow[]>(
    'admin_sessions',
    query({
      select: 'id,business_id,employee_id,csrf_token_hash,expires_at,revoked_at,reauthenticated_at',
      token_hash: `eq.${tokenHash}`,
      limit: '1',
    }),
  );
  const session = sessions[0];
  if (!session || session.revoked_at !== null) throw new AdminAuthError('session_required', 401);
  if (new Date(session.expires_at).getTime() <= now.getTime()) {
    throw new AdminAuthError('session_expired', 401);
  }

  const employees = await client.select<AdminEmployeeRow[]>(
    'business_employees',
    query({
      select: 'id,business_id,display_name,role,pin_hash,active',
      id: `eq.${session.employee_id}`,
      business_id: `eq.${session.business_id}`,
      limit: '1',
    }),
  );
  const employee = employees[0];
  if (!employee?.active) throw new AdminAuthError('employee_inactive', 403);
  const principal = await resolvePrincipal(employee, client);
  return { session, employee, principal };
}

export function requireSessionCsrf(context: AdminSessionContext, csrfToken: string): void {
  if (!csrfMatches(csrfToken, context.session.csrf_token_hash)) {
    throw new AdminAuthError('csrf_invalid', 403);
  }
}

export async function rotateSessionCsrf(
  context: AdminSessionContext,
  client: AdminSupabaseClient,
): Promise<string> {
  const next = createSessionMaterial(new Date(), 60).csrfToken;
  await client.update<unknown>(
    'admin_sessions',
    query({ id: `eq.${context.session.id}`, revoked_at: 'is.null' }),
    { csrf_token_hash: sha256Hex(next), last_seen_at: new Date().toISOString() },
  );
  return next;
}
