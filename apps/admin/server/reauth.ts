import { verifyPin } from './pin.js';

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

export type RecentlyReauthenticatedSession = {
  reauthenticated_at: string | null;
};

export class AdminRecentReauthError extends Error {
  readonly code = 'reauthentication_required';
  readonly status = 403;

  constructor() {
    super('reauthentication_required');
    this.name = 'AdminRecentReauthError';
  }
}

export function requireRecentReauth(
  session: RecentlyReauthenticatedSession,
  maxAgeSeconds: number,
  now = new Date(),
): void {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('invalid_reauthentication_window');
  }

  const raw = session.reauthenticated_at;
  if (!raw) throw new AdminRecentReauthError();

  const reauthenticatedAt = new Date(raw);
  const timestamp = reauthenticatedAt.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(timestamp) || timestamp > nowMs) {
    throw new AdminRecentReauthError();
  }

  if (nowMs - timestamp > maxAgeSeconds * 1000) {
    throw new AdminRecentReauthError();
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
