import { createHmac } from 'node:crypto';

export type AdminClientFingerprint = {
  ip: string;
  userAgent: string;
};

export type AdminPinRateLimitRpc = {
  claim(rateKey: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  clear?(rateKey: string): Promise<void>;
};

type AdminPinRateLimitClient = {
  rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T>;
};

export class AdminRateLimitError extends Error {
  readonly code = 'too_many_pin_attempts';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('too_many_pin_attempts');
    this.name = 'AdminRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function deriveAdminRateKey(
  client: AdminClientFingerprint,
  secret: string,
): Promise<string> {
  if (secret.trim().length < 16) throw new Error('rate_limit_secret_too_short');
  const normalizedIp = client.ip.trim().toLowerCase();
  const normalizedAgent = client.userAgent.trim().slice(0, 512);
  return createHmac('sha256', secret)
    .update(`tux-admin-rate-v1:${normalizedIp}\n${normalizedAgent}`)
    .digest('hex');
}

export function createAdminPinRateLimitRpc(client: AdminPinRateLimitClient): AdminPinRateLimitRpc {
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

export async function claimAdminPinAttempt(
  rateKey: string,
  rpc: AdminPinRateLimitRpc,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(rateKey)) throw new Error('invalid_rate_key');
  const result = await rpc.claim(rateKey);
  if (result.allowed) return;
  const retryAfter =
    Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds > 0
      ? result.retryAfterSeconds
      : 900;
  throw new AdminRateLimitError(retryAfter);
}

export async function clearAdminPinAttempts(
  rateKey: string,
  rpc: AdminPinRateLimitRpc,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(rateKey)) throw new Error('invalid_rate_key');
  if (rpc.clear) await rpc.clear(rateKey);
}
