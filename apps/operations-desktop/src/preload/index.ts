import type { OrderDraft, OrderId, ShopId } from '@tux/domain';
import type { TuxDesktopApi } from '@tux/platform-contracts';
import { contextBridge, ipcRenderer } from 'electron';
import {
  assertCustomerLookupResult,
  assertOrderPlacementResult,
  assertOrdersWorkspaceResult,
  assertReprintOrderResult,
  assertSaveDraftResult,
} from './ordersResult';
import { assertSessionResult } from './sessionResult';

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const IPC_SESSION_GET_STATE = 'tux:session:get-state';
const IPC_SESSION_SUBMIT_PIN = 'tux:session:submit-pin';
const IPC_SESSION_SIGN_OUT = 'tux:session:sign-out';
const IPC_ORDERS_LOAD_WORKSPACE = 'tux:orders:load-workspace';
const IPC_ORDERS_SAVE_DRAFT = 'tux:orders:save-draft';
const IPC_ORDERS_FIND_CUSTOMER = 'tux:orders:find-customer';
const IPC_ORDERS_PLACE = 'tux:orders:place';
const IPC_ORDERS_REPRINT = 'tux:orders:reprint';

const api: TuxDesktopApi = Object.freeze({
  app: Object.freeze({
    getVersion: async () => {
      const version: unknown = await ipcRenderer.invoke(IPC_GET_APP_VERSION);
      if (typeof version !== 'string') {
        throw new TypeError('Invalid app version response from Electron main process.');
      }
      return version;
    },
  }),
  session: Object.freeze({
    getState: async () =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_GET_STATE)) as unknown),
    submitPin: async (pin: string) =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_SUBMIT_PIN, pin)) as unknown),
    signOut: async () =>
      assertSessionResult((await ipcRenderer.invoke(IPC_SESSION_SIGN_OUT)) as unknown),
  }),
  orders: Object.freeze({
    loadWorkspace: async (draftScopeId: string) =>
      assertOrdersWorkspaceResult(
        (await ipcRenderer.invoke(IPC_ORDERS_LOAD_WORKSPACE, draftScopeId)) as unknown,
      ),
    saveDraft: async (draft: OrderDraft) =>
      assertSaveDraftResult((await ipcRenderer.invoke(IPC_ORDERS_SAVE_DRAFT, draft)) as unknown),
    findCustomerByPhone: async (shopId: ShopId, normalizedPhone: string) =>
      assertCustomerLookupResult(
        (await ipcRenderer.invoke(IPC_ORDERS_FIND_CUSTOMER, shopId, normalizedPhone)) as unknown,
      ),
    placeOrder: async (draft: OrderDraft) =>
      assertOrderPlacementResult((await ipcRenderer.invoke(IPC_ORDERS_PLACE, draft)) as unknown),
    reprintOrder: async (orderId: OrderId) =>
      assertReprintOrderResult(
        (await ipcRenderer.invoke(IPC_ORDERS_REPRINT, orderId)) as unknown,
      ),
  }),
});

contextBridge.exposeInMainWorld('tuxDesktop', api);
