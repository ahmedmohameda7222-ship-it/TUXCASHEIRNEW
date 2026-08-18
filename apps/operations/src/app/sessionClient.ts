import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsOrdersService,
  type OperationsSessionResult,
} from '@tux/application';
import { instant } from '@tux/domain';
import {
  IndexedDbOperationsDatabase,
  IndexedDbOperatorSessionReadModel,
  IndexedDbOrderDraftStore,
} from '@tux/persistence/browser';
import type { TuxOrdersApi } from '@tux/platform-contracts';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
}

export type OperationsOrdersClient = TuxOrdersApi;

interface BrowserRuntime {
  readonly session: CoordinatedOperationsSessionService;
  readonly orders: OperationsOrdersService;
}

let browserRuntimePromise: Promise<BrowserRuntime> | null = null;

async function browserRuntime(): Promise<BrowserRuntime> {
  if (browserRuntimePromise === null) {
    browserRuntimePromise = (async () => {
      const database = new IndexedDbOperationsDatabase();
      await database.initialize();
      const readModel = new IndexedDbOperatorSessionReadModel();
      await readModel.initialize();
      const draftStore = new IndexedDbOrderDraftStore();
      await draftStore.initialize();
      const coordinator = new ApplicationCommandCoordinator();
      const runtime = {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      };
      return {
        session: new CoordinatedOperationsSessionService(
          database,
          readModel,
          new BrowserPbkdf2PinVerifier(),
          runtime,
          coordinator,
        ),
        orders: new OperationsOrdersService(database, readModel, draftStore, runtime, coordinator),
      };
    })();
  }
  return browserRuntimePromise;
}

export function createOperationsSessionClient(): OperationsSessionClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) {
    return desktop.session;
  }
  return {
    getState: async () => (await browserRuntime()).session.getState(),
    submitPin: async (pin: string) => (await browserRuntime()).session.submitPin(pin),
    signOut: async () => (await browserRuntime()).session.signOut(),
  };
}

export function createOperationsOrdersClient(): OperationsOrdersClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) {
    return desktop.orders;
  }
  return {
    loadWorkspace: async (draftScopeId) =>
      (await browserRuntime()).orders.loadWorkspace(draftScopeId),
    saveDraft: async (draft) => (await browserRuntime()).orders.saveDraft(draft),
    findCustomerByPhone: async (shopId, normalizedPhone) =>
      (await browserRuntime()).orders.findCustomerByPhone(shopId, normalizedPhone),
    placeOrder: async (draft) => (await browserRuntime()).orders.placeOrder(draft),
  };
}
