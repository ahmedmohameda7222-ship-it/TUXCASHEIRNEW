import type { OrderDraft, OrderId, ShopId } from '@tux/domain';
import type { TuxDesktopApi } from '@tux/platform-contracts';
import { contextBridge, ipcRenderer } from 'electron';
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

const IPC_GET_APP_VERSION = 'tux:app:get-version';
const IPC_SESSION_GET_STATE = 'tux:session:get-state';
const IPC_SESSION_SUBMIT_PIN = 'tux:session:submit-pin';
const IPC_SESSION_SIGN_OUT = 'tux:session:sign-out';
const IPC_ORDERS_LOAD_WORKSPACE = 'tux:orders:load-workspace';
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
});

contextBridge.exposeInMainWorld('tuxDesktop', api);
