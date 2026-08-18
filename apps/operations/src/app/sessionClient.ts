import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  type OperationsSessionResult,
} from '@tux/application';
import { instant } from '@tux/domain';
import {
  IndexedDbOperationsDatabase,
  IndexedDbOperatorSessionReadModel,
  IndexedDbOrderDraftStore,
} from '@tux/persistence/browser';
import type { TuxOrdersApi, TuxOrdersBoardApi } from '@tux/platform-contracts';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
}

export type OperationsOrdersClient = TuxOrdersApi;
export type OperationsOrdersBoardClient = TuxOrdersBoardApi;

interface BrowserRuntime {
  readonly session: CoordinatedOperationsSessionService;
  readonly orders: OperationsOrdersService;
  readonly ordersBoard: OperationsOrdersBoardService;
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
        orders: new OperationsOrdersService(
          database,
          readModel,
          draftStore,
          runtime,
          coordinator,
          new BrowserOrderPrinter(),
        ),
        ordersBoard: new OperationsOrdersBoardService(database, readModel, runtime, coordinator),
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
    reprintOrder: async (orderId) => (await browserRuntime()).orders.reprintOrder(orderId),
  };
}

export function createOperationsOrdersBoardClient(): OperationsOrdersBoardClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) {
    return desktop.ordersBoard;
  }
  return {
    loadBoard: async () => (await browserRuntime()).ordersBoard.loadBoard(),
    markDone: async (orderId) => (await browserRuntime()).ordersBoard.markDone(orderId),
    undoDone: async (orderId) => (await browserRuntime()).ordersBoard.undoDone(orderId),
    cancelOrder: async (input) => (await browserRuntime()).ordersBoard.cancelOrder(input),
    returnDelivery: async (input) => (await browserRuntime()).ordersBoard.returnDelivery(input),
  };
}
