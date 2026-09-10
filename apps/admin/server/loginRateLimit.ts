import { createHmac } from 'node:crypto';

export type AdminClientFingerprint = {
  ip: string;
  userAgent: string;
};

export type AdminPinRateLimitRpc = {
  claim(rateKey: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  clear?(rateKey: string): Promise<void>;
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
