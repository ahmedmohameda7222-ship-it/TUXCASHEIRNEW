import { describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
  type Worker,
  type WorkerId,
} from '@tux/domain';
import { ok, type Result } from './result';
import type { OperationsSessionState } from './session';
import {
  OperationsWorkerAuthenticationService,
  type AuthoritativeWorkerAuthenticationResult,
  type AuthoritativeWorkerAuthenticator,
  type WorkerAuthenticationLocalSession,
  type WorkerCredentialStore,
} from './workerAuthentication';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const WORKER_A = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const WORKER_B = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');

function worker(id = WORKER_A, pinHash = 'pbkdf2:new'): Worker {
  return {
    id,
    shopId: SHOP_ID,
    displayName: id === WORKER_A ? 'Ahmed' : 'Maya',
    pinHash,
    active: true,
  };
}

function state(status: 'NO_ACTIVE_DAY' | 'CONFIGURATION_REQUIRED' = 'NO_ACTIVE_DAY') {
  return status === 'CONFIGURATION_REQUIRED'
    ? ({ status, message: 'Configuration required.' } as const)
    : ({ status, shopId: SHOP_ID } as const);
}

class FakeSession implements WorkerAuthenticationLocalSession {
  readonly submittedPins: string[] = [];
  readonly submittedWorkers: Worker[] = [];
  constructor(
    readonly initial: OperationsSessionState,
    readonly submitted: Result<OperationsSessionState, never> = ok({
      status: 'NO_ACTIVE_DAY',
      shopId: SHOP_ID,
    }),
  ) {}

  async getState() {
    return ok(this.initial);
  }

  async submitPin(pin: string) {
    this.submittedPins.push(pin);
    return this.submitted;
  }

  async submitAuthenticatedWorker(value: Worker) {
    this.submittedWorkers.push(value);
    return this.submitted;
  }
}

class FakeAuthenticator implements AuthoritativeWorkerAuthenticator {
  readonly pins: string[] = [];
  constructor(readonly result: AuthoritativeWorkerAuthenticationResult) {}

  async authenticate(pin: string) {
    this.pins.push(pin);
    return this.result;
  }
}

class FakeStore implements WorkerCredentialStore {
  readonly workers: Worker[] = [];
  readonly fencedPins: string[] = [];
  constructor(readonly fail = false) {}

  async put(value: Worker) {
    if (this.fail) throw new Error('persistence failed');
    this.workers.push(value);
  }

  async fenceMatchingPin(pin: string) {
    if (this.fail) throw new Error('persistence failed');
    this.fencedPins.push(pin);
  }
}

function fixture(
  remote: AuthoritativeWorkerAuthenticationResult,
  localState: OperationsSessionState = state(),
  submitted?: Result<OperationsSessionState, never>,
  store = new FakeStore(),
) {
  const session = new FakeSession(localState, submitted);
  const authenticator = new FakeAuthenticator(remote);
  return {
    session,
    authenticator,
    store,
    service: new OperationsWorkerAuthenticationService(session, authenticator, store),
  };
}

describe('OperationsWorkerAuthenticationService', () => {
  it('A rejects and fences a stale cached PIN when the reachable backend rejects it', async () => {
    const { service, session, store } = fixture({ status: 'REJECTED', message: 'Invalid PIN.' });
    await expect(service.submitPin('1111')).resolves.toEqual({
      ok: false,
      error: { code: 'PIN_AUTH_ERROR', message: 'Invalid PIN.' },
    });
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([]);
    expect(store.fencedPins).toEqual(['1111']);
  });

  it('B accepts a rotated authoritative PIN only after refreshing and selecting the exact worker', async () => {
    const current = worker(WORKER_A, 'pbkdf2:rotated');
    const { service, store, session } = fixture({ status: 'AUTHENTICATED', worker: current });
    await service.submitPin('2222');
    expect(store.workers).toEqual([current]);
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([current]);
  });

  it('C rejects a deactivated worker response without cached fallback', async () => {
    const { service, session } = fixture({ status: 'REJECTED', message: 'Worker is inactive.' });
    const result = await service.submitPin('1234');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected rejection.');
    expect(result.error.code).toBe('PIN_AUTH_ERROR');
    expect(session.submittedPins).toEqual([]);
  });

  it('D never treats throttling as offline unavailability', async () => {
    const { service, session } = fixture({ status: 'THROTTLED', message: 'Too many attempts.' });
    const result = await service.submitPin('1234');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected throttle rejection.');
    expect(result.error).toEqual({ code: 'PIN_AUTH_ERROR', message: 'Too many attempts.' });
    expect(session.submittedPins).toEqual([]);
  });

  it.each(['DEVICE_SESSION_INVALID', 'INVALID_REQUEST', 'INVALID_RESPONSE', 'SERVER_ERROR'] as const)(
    'E treats %s as authoritative remote failure rather than offline fallback',
    async (status) => {
      const { service, session, store } = fixture({ status, message: `remote ${status}` });
      const result = await service.submitPin('1234');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected remote failure.');
      expect(result.error.code).toBe('REMOTE_SYNC_ERROR');
      expect(session.submittedPins).toEqual([]);
      expect(store.fencedPins).toEqual([]);
    },
  );

  it('F falls back to cached PIN verification only for explicit remote unavailability on an activated installation', async () => {
    const { service, session } = fixture({ status: 'UNAVAILABLE', message: 'offline' });
    const result = await service.submitPin('1234');
    expect(result.ok).toBe(true);
    expect(session.submittedPins).toEqual(['1234']);
    expect(session.submittedWorkers).toEqual([]);
  });

  it('G never attempts remote or cached PIN authentication for a fresh unactivated installation', async () => {
    const { service, session, authenticator } = fixture(
      { status: 'UNAVAILABLE', message: 'offline' },
      state('CONFIGURATION_REQUIRED'),
    );
    await expect(service.submitPin('1234')).resolves.toEqual(ok(state('CONFIGURATION_REQUIRED')));
    expect(authenticator.pins).toEqual([]);
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([]);
  });

  it('H preserves worker switching by persisting and selecting the exact authoritative worker', async () => {
    const switchedState = ok({
      status: 'ACTIVE' as const,
      shopId: SHOP_ID,
      businessDayId: parseEntityId<BusinessDayId>('30000000-0000-4000-8000-000000000001'),
      businessDayStartedAt: instant(new Date('2026-09-01T10:00:00.000Z')),
      operator: { id: WORKER_B, displayName: 'Maya' },
    });
    const current = worker(WORKER_B, 'pbkdf2:maya');
    const { service, store, session } = fixture(
      { status: 'AUTHENTICATED', worker: current },
      state(),
      switchedState,
    );
    const result = await service.submitPin('5678');
    expect(result).toEqual(switchedState);
    expect(store.workers).toEqual([current]);
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([current]);
  });

  it('does not downgrade a local credential persistence failure into offline fallback', async () => {
    const { service, session } = fixture(
      { status: 'AUTHENTICATED', worker: worker() },
      state(),
      undefined,
      new FakeStore(true),
    );
    const result = await service.submitPin('1234');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected persistence failure.');
    expect(result.error.code).toBe('LOCAL_PERSISTENCE_ERROR');
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([]);
  });

  it('surfaces device-session local persistence failures without offline fallback', async () => {
    const cause = new Error('session store failed');
    const { service, session } = fixture({
      status: 'LOCAL_PERSISTENCE_ERROR',
      message: 'Could not persist refreshed device session.',
      cause,
    });
    const result = await service.submitPin('1234');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected local persistence failure.');
    expect(result.error.code).toBe('LOCAL_PERSISTENCE_ERROR');
    expect(session.submittedPins).toEqual([]);
    expect(session.submittedWorkers).toEqual([]);
  });
});
