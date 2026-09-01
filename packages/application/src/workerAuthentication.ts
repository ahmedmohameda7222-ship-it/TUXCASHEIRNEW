import type { Worker } from '@tux/domain';
import { err } from './result';
import type { OperationsSessionResult } from './session';

export type AuthoritativeWorkerAuthenticationResult =
  | { readonly status: 'AUTHENTICATED'; readonly worker: Worker }
  | { readonly status: 'REJECTED'; readonly message: string }
  | { readonly status: 'THROTTLED'; readonly message: string }
  | { readonly status: 'INVALID_REQUEST'; readonly message: string }
  | { readonly status: 'INVALID_RESPONSE'; readonly message: string }
  | { readonly status: 'SERVER_ERROR'; readonly message: string }
  | { readonly status: 'UNAVAILABLE'; readonly message: string };

export interface AuthoritativeWorkerAuthenticator {
  authenticate(pin: string): Promise<AuthoritativeWorkerAuthenticationResult>;
}

export interface WorkerAuthenticationLocalSession {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
}

export interface WorkerCredentialStore {
  put(worker: Worker): Promise<void>;
}

export class OperationsWorkerAuthenticationService {
  readonly #session: WorkerAuthenticationLocalSession;
  readonly #authenticator: AuthoritativeWorkerAuthenticator;
  readonly #workerStore: WorkerCredentialStore;

  constructor(
    session: WorkerAuthenticationLocalSession,
    authenticator: AuthoritativeWorkerAuthenticator,
    workerStore: WorkerCredentialStore,
  ) {
    this.#session = session;
    this.#authenticator = authenticator;
    this.#workerStore = workerStore;
  }

  async submitPin(pin: string): Promise<OperationsSessionResult> {
    const state = await this.#session.getState();
    if (!state.ok || state.value.status === 'CONFIGURATION_REQUIRED') return state;

    let remote: AuthoritativeWorkerAuthenticationResult;
    try {
      remote = await this.#authenticator.authenticate(pin);
    } catch (cause) {
      return err({
        code: 'REMOTE_SYNC_ERROR',
        message: 'Could not authenticate the worker with the remote authority.',
        cause,
      });
    }

    switch (remote.status) {
      case 'AUTHENTICATED':
        try {
          await this.#workerStore.put(remote.worker);
        } catch (cause) {
          return err({
            code: 'LOCAL_PERSISTENCE_ERROR',
            message: 'Could not persist the authoritative worker credential locally.',
            cause,
          });
        }
        return this.#session.submitPin(pin);
      case 'REJECTED':
      case 'THROTTLED':
        return err({ code: 'PIN_AUTH_ERROR', message: remote.message });
      case 'INVALID_REQUEST':
      case 'INVALID_RESPONSE':
      case 'SERVER_ERROR':
        return err({ code: 'REMOTE_SYNC_ERROR', message: remote.message });
      case 'UNAVAILABLE':
        return this.#session.submitPin(pin);
    }
  }
}
