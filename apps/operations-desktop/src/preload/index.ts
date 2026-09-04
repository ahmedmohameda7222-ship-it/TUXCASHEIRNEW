import {
  parseWorkerMenuLayout,
  parseWorkerUiPreferences,
  type OrderDraft,
  type OrderId,
  type ShopId,
} from '@tux/domain';
import type { TuxDesktopApi } from '@tux/platform-contracts';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { assertBulkStockBoardResult, assertBulkStockMutationResult } from './bulkStockResult';
import {
  assertEndDayCloseResult,
  assertEndDayDiscardResult,
  assertEndDayGateResult,
  assertEndDayPreviewResult,
} from './endDayResult';
import { assertExpenseMutationResult, assertExpensesLedgerResult } from './expensesResult';
import {
  assertCustomerLookupResult,
  assertOrderPlacementResult,
  assertOrdersWorkspaceResult,
  assertReprintOrderResult,
  assertSaveDraftResult,
} from './ordersResult';
import { assertOrderTransitionResult, assertOrdersBoardResult } from './ordersBoardResult';
import { assertSessionResult } from './sessionResult';
import {
  assertWhatsAppConversationResult,
  assertWhatsAppDraftResult,
  assertWhatsAppInboxResult,
  assertWhatsAppMessageResult,
  assertWhatsAppVoidResult,
} from './whatsappResult';
import { assertSyncHealthSnapshot } from './syncStatusResult';

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const IPC_SESSION_GET_STATE = 'tux:session:get-state';
const IPC_SESSION_SUBMIT_PIN = 'tux:session:submit-pin';
const IPC_SESSION_SIGN_OUT = 'tux:session:sign-out';
const IPC_SYNC_GET_STATUS = 'tux:sync:get-status';
const IPC_SYNC_STATUS_CHANGED = 'tux:sync:status-changed';
const IPC_WORKER_MENU_LAYOUT_LOAD = 'tux:worker-menu-layout:load';
const IPC_WORKER_MENU_LAYOUT_CHANGED = 'tux:worker-menu-layout:changed';
const IPC_WORKER_MENU_LAYOUT_UPDATE = 'tux:worker-menu-layout:update';
const IPC_WORKER_MENU_LAYOUT_RESET = 'tux:worker-menu-layout:reset';
const IPC_WORKER_MENU_LAYOUT_RETRY = 'tux:worker-menu-layout:retry';
const IPC_WORKER_UI_PREFERENCES_LOAD = 'tux:worker-ui-preferences:load';
const IPC_WORKER_UI_PREFERENCES_CHANGED = 'tux:worker-ui-preferences:changed';
const IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT = 'tux:worker-ui-preferences:update-menu-layout';
const IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT = 'tux:worker-ui-preferences:update-accent';
const IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT = 'tux:worker-ui-preferences:reset-menu-layout';
const IPC_ORDERS_LOAD_WORKSPACE = 'tux:orders:load-workspace';
const IPC_ORDERS_START_FROM_PREFILL = 'tux:orders:start-from-prefill';
const IPC_ORDERS_RESTORE_PARKED = 'tux:orders:restore-parked';
const IPC_ORDERS_DISCARD_PARKED = 'tux:orders:discard-parked';
const IPC_ORDERS_SAVE_DRAFT = 'tux:orders:save-draft';
const IPC_ORDERS_FIND_CUSTOMER = 'tux:orders:find-customer';
const IPC_ORDERS_PLACE = 'tux:orders:place';
const IPC_ORDERS_REPRINT = 'tux:orders:reprint';
const IPC_BOARD_LOAD = 'tux:orders-board:load';
const IPC_BOARD_MARK_DONE = 'tux:orders-board:mark-done';
const IPC_BOARD_UNDO_DONE = 'tux:orders-board:undo-done';
const IPC_BOARD_CANCEL = 'tux:orders-board:cancel';
const IPC_BOARD_RETURN = 'tux:orders-board:return';
const IPC_EXPENSES_LOAD = 'tux:expenses:load';
const IPC_EXPENSES_CREATE = 'tux:expenses:create';
const IPC_EXPENSES_EDIT = 'tux:expenses:edit';
const IPC_EXPENSES_DELETE = 'tux:expenses:delete';
const IPC_BULK_LOAD = 'tux:bulk-stock:load';
const IPC_BULK_FINISH_ONE = 'tux:bulk-stock:finish-one';
const IPC_BULK_ADD = 'tux:bulk-stock:add';
const IPC_BULK_UNDO = 'tux:bulk-stock:undo';
const IPC_END_DAY_BEGIN = 'tux:end-day:begin';
const IPC_END_DAY_DISCARD_DRAFT = 'tux:end-day:discard-draft';
const IPC_END_DAY_PREVIEW = 'tux:end-day:preview';
const IPC_END_DAY_CLOSE = 'tux:end-day:close';
const IPC_WHATSAPP_LOAD_INBOX = 'tux:whatsapp:load-inbox';
const IPC_WHATSAPP_LOAD_CONVERSATION = 'tux:whatsapp:load-conversation';
const IPC_WHATSAPP_SEND_TEXT = 'tux:whatsapp:send-text';
const IPC_WHATSAPP_MARK_UNREAD = 'tux:whatsapp:mark-unread';
const IPC_WHATSAPP_ARCHIVE = 'tux:whatsapp:archive';
const IPC_WHATSAPP_SET_FOLLOW_UP = 'tux:whatsapp:set-follow-up';
const IPC_WHATSAPP_LINK_ORDER = 'tux:whatsapp:link-order';
const IPC_WHATSAPP_SAVE_DRAFT = 'tux:whatsapp:save-draft';
const IPC_WHATSAPP_GET_DRAFT = 'tux:whatsapp:get-draft';

type WorkerMenuLayoutInput = Parameters<TuxDesktopApi['workerMenuLayout']['updateMenuLayout']>[0];
type WorkerLegacyMenuLayoutInput = Parameters<
  TuxDesktopApi['workerUiPreferences']['updateMenuLayout']
>[0];
type WorkerAccentInput = Parameters<TuxDesktopApi['workerUiPreferences']['updateAccentColor']>[0];

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
  sync: Object.freeze({
    getStatus: async () =>
      assertSyncHealthSnapshot((await ipcRenderer.invoke(IPC_SYNC_GET_STATUS)) as unknown),
    subscribe: (listener: Parameters<TuxDesktopApi['sync']['subscribe']>[0]) => {
      const wrapper = (_event: IpcRendererEvent, value: unknown): void => {
        listener(assertSyncHealthSnapshot(value));
      };
      ipcRenderer.on(IPC_SYNC_STATUS_CHANGED, wrapper);
      return () => ipcRenderer.removeListener(IPC_SYNC_STATUS_CHANGED, wrapper);
    },
  }),
  workerMenuLayout: Object.freeze({
    load: async () => {
      const value: unknown = await ipcRenderer.invoke(IPC_WORKER_MENU_LAYOUT_LOAD);
      return value === null ? null : parseWorkerMenuLayout(value);
    },
    subscribe: (listener: Parameters<TuxDesktopApi['workerMenuLayout']['subscribe']>[0]) => {
      const wrapper = (_event: IpcRendererEvent, value: unknown): void => {
        listener(parseWorkerMenuLayout(value));
      };
      ipcRenderer.on(IPC_WORKER_MENU_LAYOUT_CHANGED, wrapper);
      return () => ipcRenderer.removeListener(IPC_WORKER_MENU_LAYOUT_CHANGED, wrapper);
    },
    updateMenuLayout: async (input: WorkerMenuLayoutInput) => {
      const value: unknown = await ipcRenderer.invoke(IPC_WORKER_MENU_LAYOUT_UPDATE, input);
      return parseWorkerMenuLayout(value);
    },
    resetMenuLayout: async () => {
      await ipcRenderer.invoke(IPC_WORKER_MENU_LAYOUT_RESET);
    },
  }),
  workerUiPreferences: Object.freeze({
    load: async () => {
      const value: unknown = await ipcRenderer.invoke(IPC_WORKER_UI_PREFERENCES_LOAD);
      return value === null ? null : parseWorkerUiPreferences(value);
    },
    subscribe: (listener: Parameters<TuxDesktopApi['workerUiPreferences']['subscribe']>[0]) => {
      const wrapper = (_event: IpcRendererEvent, value: unknown): void => {
        listener(parseWorkerUiPreferences(value));
      };
      ipcRenderer.on(IPC_WORKER_UI_PREFERENCES_CHANGED, wrapper);
      return () => ipcRenderer.removeListener(IPC_WORKER_UI_PREFERENCES_CHANGED, wrapper);
    },
    updateMenuLayout: async (input: WorkerLegacyMenuLayoutInput) => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT,
        input,
      );
      return parseWorkerUiPreferences(value);
    },
    updateAccentColor: async (accentColor: WorkerAccentInput) => {
      const value: unknown = await ipcRenderer.invoke(
        IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT,
        accentColor,
      );
      return parseWorkerUiPreferences(value);
    },
    resetMenuLayout: async () => {
      await ipcRenderer.invoke(IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT);
    },
  }),
  orders: Object.freeze({
    loadWorkspace: async (draftScopeId: string) =>
      assertOrdersWorkspaceResult(
        (await ipcRenderer.invoke(IPC_ORDERS_LOAD_WORKSPACE, draftScopeId)) as unknown,
      ),
    startOrderFromCustomerPrefill: async (
      input: Parameters<TuxDesktopApi['orders']['startOrderFromCustomerPrefill']>[0],
    ) =>
      assertOrdersWorkspaceResult(
        (await ipcRenderer.invoke(IPC_ORDERS_START_FROM_PREFILL, input)) as unknown,
      ),
    restoreParkedDraft: async (
      input: Parameters<TuxDesktopApi['orders']['restoreParkedDraft']>[0],
    ) =>
      assertOrdersWorkspaceResult(
        (await ipcRenderer.invoke(IPC_ORDERS_RESTORE_PARKED, input)) as unknown,
      ),
    discardParkedDraft: async (
      input: Parameters<TuxDesktopApi['orders']['discardParkedDraft']>[0],
    ) => {
      const result = (await ipcRenderer.invoke(IPC_ORDERS_DISCARD_PARKED, input)) as unknown;
      if (
        typeof result !== 'object' ||
        result === null ||
        Array.isArray(result) ||
        !('ok' in result)
      ) {
        throw new TypeError('Invalid Orders parked-discard response from Electron main process.');
      }
      return result as Awaited<ReturnType<TuxDesktopApi['orders']['discardParkedDraft']>>;
    },
    saveDraft: async (draft: OrderDraft) =>
      assertSaveDraftResult((await ipcRenderer.invoke(IPC_ORDERS_SAVE_DRAFT, draft)) as unknown),
    findCustomerByPhone: async (shopId: ShopId, normalizedPhone: string) =>
      assertCustomerLookupResult(
        (await ipcRenderer.invoke(IPC_ORDERS_FIND_CUSTOMER, shopId, normalizedPhone)) as unknown,
      ),
    placeOrder: async (draft: OrderDraft) =>
      assertOrderPlacementResult((await ipcRenderer.invoke(IPC_ORDERS_PLACE, draft)) as unknown),
    reprintOrder: async (orderId: OrderId) =>
      assertReprintOrderResult((await ipcRenderer.invoke(IPC_ORDERS_REPRINT, orderId)) as unknown),
  }),
  ordersBoard: Object.freeze({
    loadBoard: async () =>
      assertOrdersBoardResult((await ipcRenderer.invoke(IPC_BOARD_LOAD)) as unknown),
    markDone: async (orderId: OrderId) =>
      assertOrderTransitionResult(
        (await ipcRenderer.invoke(IPC_BOARD_MARK_DONE, orderId)) as unknown,
      ),
    undoDone: async (orderId: OrderId) =>
      assertOrderTransitionResult(
        (await ipcRenderer.invoke(IPC_BOARD_UNDO_DONE, orderId)) as unknown,
      ),
    cancelOrder: async (input: Parameters<TuxDesktopApi['ordersBoard']['cancelOrder']>[0]) =>
      assertOrderTransitionResult((await ipcRenderer.invoke(IPC_BOARD_CANCEL, input)) as unknown),
    returnDelivery: async (input: Parameters<TuxDesktopApi['ordersBoard']['returnDelivery']>[0]) =>
      assertOrderTransitionResult((await ipcRenderer.invoke(IPC_BOARD_RETURN, input)) as unknown),
  }),
  expenses: Object.freeze({
    loadLedger: async () =>
      assertExpensesLedgerResult((await ipcRenderer.invoke(IPC_EXPENSES_LOAD)) as unknown),
    createExpense: async (input: Parameters<TuxDesktopApi['expenses']['createExpense']>[0]) =>
      assertExpenseMutationResult(
        (await ipcRenderer.invoke(IPC_EXPENSES_CREATE, input)) as unknown,
      ),
    editExpense: async (input: Parameters<TuxDesktopApi['expenses']['editExpense']>[0]) =>
      assertExpenseMutationResult((await ipcRenderer.invoke(IPC_EXPENSES_EDIT, input)) as unknown),
    deleteExpense: async (expenseId: Parameters<TuxDesktopApi['expenses']['deleteExpense']>[0]) =>
      assertExpenseMutationResult(
        (await ipcRenderer.invoke(IPC_EXPENSES_DELETE, expenseId)) as unknown,
      ),
  }),
  bulkStock: Object.freeze({
    loadBoard: async () =>
      assertBulkStockBoardResult((await ipcRenderer.invoke(IPC_BULK_LOAD)) as unknown),
    finishOne: async (input: Parameters<TuxDesktopApi['bulkStock']['finishOne']>[0]) =>
      assertBulkStockMutationResult(
        (await ipcRenderer.invoke(IPC_BULK_FINISH_ONE, input)) as unknown,
      ),
    addStock: async (input: Parameters<TuxDesktopApi['bulkStock']['addStock']>[0]) =>
      assertBulkStockMutationResult((await ipcRenderer.invoke(IPC_BULK_ADD, input)) as unknown),
    undoMovement: async (input: Parameters<TuxDesktopApi['bulkStock']['undoMovement']>[0]) =>
      assertBulkStockMutationResult((await ipcRenderer.invoke(IPC_BULK_UNDO, input)) as unknown),
  }),
  endDay: Object.freeze({
    beginEndDay: async (draftScopeId: string) =>
      assertEndDayGateResult(
        (await ipcRenderer.invoke(IPC_END_DAY_BEGIN, draftScopeId)) as unknown,
      ),
    discardDraft: async (draftScopeId: string) =>
      assertEndDayDiscardResult(
        (await ipcRenderer.invoke(IPC_END_DAY_DISCARD_DRAFT, draftScopeId)) as unknown,
      ),
    previewReconciliation: async (
      input: Parameters<TuxDesktopApi['endDay']['previewReconciliation']>[0],
    ) =>
      assertEndDayPreviewResult((await ipcRenderer.invoke(IPC_END_DAY_PREVIEW, input)) as unknown),
    closeDay: async (input: Parameters<TuxDesktopApi['endDay']['closeDay']>[0]) =>
      assertEndDayCloseResult((await ipcRenderer.invoke(IPC_END_DAY_CLOSE, input)) as unknown),
  }),
  whatsapp: Object.freeze({
    loadInbox: async (cursor?: string) =>
      assertWhatsAppInboxResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_LOAD_INBOX, cursor)) as unknown,
      ),
    loadConversation: async (conversationId: string) =>
      assertWhatsAppConversationResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_LOAD_CONVERSATION, conversationId)) as unknown,
      ),
    sendText: async (input: Parameters<TuxDesktopApi['whatsapp']['sendText']>[0]) =>
      assertWhatsAppMessageResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_SEND_TEXT, input)) as unknown,
      ),
    markUnread: async (conversationId: string) =>
      assertWhatsAppVoidResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_MARK_UNREAD, conversationId)) as unknown,
      ),
    archive: async (conversationId: string, archived?: boolean) =>
      assertWhatsAppVoidResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_ARCHIVE, conversationId, archived)) as unknown,
      ),
    setFollowUp: async (conversationId: string, followUp: boolean) =>
      assertWhatsAppVoidResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_SET_FOLLOW_UP, conversationId, followUp)) as unknown,
      ),
    linkOrder: async (input: Parameters<TuxDesktopApi['whatsapp']['linkOrder']>[0]) =>
      assertWhatsAppVoidResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_LINK_ORDER, input)) as unknown,
      ),
    saveDraft: async (conversationId: string, text: string) =>
      assertWhatsAppVoidResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_SAVE_DRAFT, conversationId, text)) as unknown,
      ),
    getDraft: async (conversationId: string) =>
      assertWhatsAppDraftResult(
        (await ipcRenderer.invoke(IPC_WHATSAPP_GET_DRAFT, conversationId)) as unknown,
      ),
  }),
});

window.addEventListener('online', () => {
  void ipcRenderer.invoke(IPC_WORKER_MENU_LAYOUT_RETRY).catch(() => undefined);
});

contextBridge.exposeInMainWorld('tuxDesktop', api);
