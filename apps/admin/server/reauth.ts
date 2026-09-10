import { verifyPin } from './pin';

export type ReauthenticatableSession = {
  sessionId: string;
  employeeId: string;
  pinHash: string;
};

export type AdminReauthDependencies = {
  now(): Date;
  markReauthenticated(sessionId: string, at: Date): Promise<void>;
};

export class AdminReauthError extends Error {
  readonly code = 'invalid_pin';
  readonly status = 401;

  constructor() {
    super('invalid_pin');
    this.name = 'AdminReauthError';
  }
}

export async function reauthenticateAdminSession(
  session: ReauthenticatableSession,
  pin: string,
  deps: AdminReauthDependencies,
): Promise<Date> {
  if (!(await verifyPin(pin, session.pinHash))) throw new AdminReauthError();
  const at = deps.now();
  await deps.markReauthenticated(session.sessionId, at);
  return at;
}
