import { parseOperationsConfigurationBundle } from '@tux/domain';
import type { OperationsConfigurationBundle, ShopId } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import type { ApplicationCommandCoordinator } from './commandCoordinator';

export interface InboundConfigurationProvider {
  discoverVersion(shopId: ShopId): Promise<number | null>;
  fetchCompleteConfiguration(shopId: ShopId, version: number): Promise<unknown>;
}

export type ConfigurationApplicationResult =
  | { readonly status: 'APPLIED'; readonly version: number }
  | { readonly status: 'UP_TO_DATE'; readonly version: number | null }
  | { readonly status: 'REMOTE_UNAVAILABLE'; readonly localVersion: number | null }
  | {
      readonly status: 'INVALID_REMOTE_CONFIGURATION';
      readonly localVersion: number | null;
      readonly message: string;
    }
  | {
      readonly status: 'LOCAL_PERSISTENCE_ERROR';
      readonly localVersion: number | null;
      readonly message: string;
    };

function validRemoteVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Future Admin/backend delivery boundary. Remote discovery/fetch is optional; the last known-good local
 * snapshot remains authoritative whenever transport or validation fails.
 */
export class OperationsConfigurationSyncService {
  readonly #database: OperationsDatabase;
  readonly #coordinator: ApplicationCommandCoordinator;
  readonly #provider: InboundConfigurationProvider;

  constructor(
    database: OperationsDatabase,
    coordinator: ApplicationCommandCoordinator,
    provider: InboundConfigurationProvider,
  ) {
    this.#database = database;
    this.#coordinator = coordinator;
    this.#provider = provider;
  }

  async sync(shopId: ShopId): Promise<ConfigurationApplicationResult> {
    const localVersion = await this.#localVersion(shopId);
    let remoteVersion: number | null;
    try {
      remoteVersion = await this.#provider.discoverVersion(shopId);
    } catch {
      return { status: 'REMOTE_UNAVAILABLE', localVersion };
    }
    if (remoteVersion === null) return { status: 'UP_TO_DATE', version: localVersion };
    if (!validRemoteVersion(remoteVersion)) {
      return {
        status: 'INVALID_REMOTE_CONFIGURATION',
        localVersion,
        message: 'Remote configuration version must be a positive safe integer.',
      };
    }
    if (localVersion !== null && remoteVersion <= localVersion) {
      return { status: 'UP_TO_DATE', version: localVersion };
    }

    let remotePayload: unknown;
    try {
      remotePayload = await this.#provider.fetchCompleteConfiguration(shopId, remoteVersion);
    } catch {
      return { status: 'REMOTE_UNAVAILABLE', localVersion };
    }

    let bundle: OperationsConfigurationBundle;
    try {
      bundle = parseOperationsConfigurationBundle(remotePayload, shopId);
      if (bundle.snapshot.version !== remoteVersion) {
        throw new TypeError('Fetched configuration version does not match discovered version.');
      }
    } catch (cause) {
      return {
        status: 'INVALID_REMOTE_CONFIGURATION',
        localVersion,
        message: cause instanceof Error ? cause.message : 'Remote configuration validation failed.',
      };
    }
    return this.#applyBundle(shopId, bundle);
  }

  /** Initial device provisioning uses the same validation and atomic application path as future sync. */
  async installProvisionedConfiguration(
    shopId: ShopId,
    payload: unknown,
  ): Promise<ConfigurationApplicationResult> {
    const localVersion = await this.#localVersion(shopId);
    let bundle: OperationsConfigurationBundle;
    try {
      bundle = parseOperationsConfigurationBundle(payload, shopId);
    } catch (cause) {
      return {
        status: 'INVALID_REMOTE_CONFIGURATION',
        localVersion,
        message:
          cause instanceof Error ? cause.message : 'Provisioned configuration validation failed.',
      };
    }
    return this.#applyBundle(shopId, bundle);
  }

  async #localVersion(shopId: ShopId): Promise<number | null> {
    try {
      const snapshot = await this.#database.transaction((transaction) =>
        transaction.configuration.getForShop(shopId),
      );
      return snapshot?.version ?? null;
    } catch {
      return null;
    }
  }

  async #applyBundle(
    shopId: ShopId,
    bundle: OperationsConfigurationBundle,
  ): Promise<ConfigurationApplicationResult> {
    return this.#coordinator.runExclusive(async () => {
      let beforeVersion: number | null = null;
      try {
        return await this.#database.transaction(async (transaction) => {
          const before = await transaction.configuration.getForShop(shopId);
          beforeVersion = before?.version ?? null;
          if (before !== null && bundle.snapshot.version <= before.version) {
            return { status: 'UP_TO_DATE', version: before.version } as const;
          }
          await transaction.configuration.put(bundle.snapshot);
          await transaction.inventory.replaceConfigurationItems(shopId, bundle.inventoryItems);
          return { status: 'APPLIED', version: bundle.snapshot.version } as const;
        });
      } catch (cause) {
        return {
          status: 'LOCAL_PERSISTENCE_ERROR',
          localVersion: beforeVersion,
          message:
            cause instanceof Error ? cause.message : 'Local configuration replacement failed.',
        };
      }
    });
  }
}
