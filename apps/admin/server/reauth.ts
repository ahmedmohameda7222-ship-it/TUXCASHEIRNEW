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

export async function reauthenticateAdminSession(
  session: ReauthenticatableSession,
  pin: string,
  deps: AdminReauthDependencies,
): Promise<Date> {
  if (!(await verifyPin(pin, session.pinHash))) throw new Error('invalid_pin');
  const at = deps.now();
  await deps.markReauthenticated(session.sessionId, at);
  return at;
}
