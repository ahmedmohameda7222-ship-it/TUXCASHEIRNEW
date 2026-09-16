import {
  claimAdminPinAttempt,
  clearAdminPinAttempts,
  deriveAdminRateKey,
  type AdminClientFingerprint,
  type AdminPinRateLimitRpc,
} from '../loginRateLimit';

export type ApprovalPinRateLimitInput = {
  employeeId: string;
  sessionId: string;
  pin: string;
  fingerprint: AdminClientFingerprint;
  rateLimitSecret: string;
};

export type ApprovalPinRateLimitDependencies = {
  verifyEmployeePin(employeeId: string, pin: string): Promise<boolean>;
  limiter: AdminPinRateLimitRpc;
};

export async function verifyApprovalPinWithRateLimit(
  input: ApprovalPinRateLimitInput,
  deps: ApprovalPinRateLimitDependencies,
): Promise<boolean> {
  const rateKey = await deriveAdminRateKey(
    {
      ip: `${input.fingerprint.ip}|approval:${input.sessionId}:${input.employeeId}`,
      userAgent: input.fingerprint.userAgent,
    },
    input.rateLimitSecret,
  );

  await claimAdminPinAttempt(rateKey, deps.limiter);
  const valid = await deps.verifyEmployeePin(input.employeeId, input.pin);
  if (valid) await clearAdminPinAttempts(rateKey, deps.limiter);
  return valid;
}
