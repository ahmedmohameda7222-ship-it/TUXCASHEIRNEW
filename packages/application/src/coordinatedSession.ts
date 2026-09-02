import type { Worker } from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';
import type { ApplicationCommandCoordinator } from './commandCoordinator';
import {
  OperationsSessionService,
  type OperationsSessionResult,
  type PinVerifier,
  type SessionRuntime,
} from './session';

/**
 * Wraps the Phase 3 session service in the same device-local command queue used
 * by Orders. This prevents operator switch/sign-out from interleaving with a
 * checkout that is resolving the Current Operator for durable attribution.
 */
export class CoordinatedOperationsSessionService extends OperationsSessionService {
  readonly #coordinator: ApplicationCommandCoordinator;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    pinVerifier: PinVerifier,
    runtime: SessionRuntime,
    coordinator: ApplicationCommandCoordinator,
  ) {
    super(database, readModel, pinVerifier, runtime);
    this.#coordinator = coordinator;
  }

  override async getState(): Promise<OperationsSessionResult> {
    return this.#coordinator.runExclusive(() => super.getState());
  }

  override async submitPin(pin: string): Promise<OperationsSessionResult> {
    return this.#coordinator.runExclusive(() => super.submitPin(pin));
  }

  override async submitAuthenticatedWorker(
    pin: string,
    worker: Worker,
  ): Promise<OperationsSessionResult> {
    return this.#coordinator.runExclusive(() => super.submitAuthenticatedWorker(pin, worker));
  }

  override async signOut(): Promise<OperationsSessionResult> {
    return this.#coordinator.runExclusive(() => super.signOut());
  }
}
