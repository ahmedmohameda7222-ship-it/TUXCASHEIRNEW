import type { Worker } from '@tux/domain';
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
    void pin;
    void this.#session;
    void this.#authenticator;
    void this.#workerStore;
    throw new Error('worker authentication policy not implemented');
  }
}
