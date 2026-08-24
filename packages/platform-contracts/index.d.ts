import type {
  OperationsBulkStockService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  OperationsSessionResult,
} from '@tux/application';

export type TuxSyncHealthSnapshot =
  | {
      readonly state: 'LOCAL_ONLY';
      readonly label: 'Local only';
      readonly remoteConfigured: false;
      readonly attentionRequired: false;
    }
  | {
      readonly state: 'SYNC_PENDING';
      readonly label: 'Sync pending';
      readonly remoteConfigured: true;
      readonly attentionRequired: false;
    }
  | {
      readonly state: 'SYNCING';
      readonly label: 'Syncing';
      readonly remoteConfigured: true;
      readonly attentionRequired: false;
    }
  | {
      readonly state: 'SYNCED';
      readonly label: 'Synced';
      readonly remoteConfigured: true;
      readonly attentionRequired: false;
    }
  | {
      readonly state: 'SYNC_RETRYING';
      readonly label: 'Sync retrying';
      readonly remoteConfigured: true;
      readonly attentionRequired: false;
    }
  | {
      readonly state: 'SYNC_ISSUE';
      readonly label: 'Sync issue';
      readonly remoteConfigured: true;
      readonly attentionRequired: true;
    };

export type TuxOrdersApi = Pick<
  OperationsOrdersService,
  'loadWorkspace' | 'saveDraft' | 'findCustomerByPhone' | 'placeOrder' | 'reprintOrder'
>;

export type TuxOrdersBoardApi = Pick<
  OperationsOrdersBoardService,
  'loadBoard' | 'markDone' | 'undoDone' | 'cancelOrder' | 'returnDelivery'
>;

export type TuxExpensesApi = Pick<
  OperationsExpensesService,
  'loadLedger' | 'createExpense' | 'editExpense' | 'deleteExpense'
>;

export type TuxBulkStockApi = Pick<
  OperationsBulkStockService,
  'loadBoard' | 'finishOne' | 'addStock' | 'undoMovement'
>;

export type TuxEndDayApi = Pick<
  OperationsEndDayService,
  'beginEndDay' | 'discardDraft' | 'previewReconciliation' | 'closeDay'
>;

export interface TuxDesktopApi {
  readonly app: {
    readonly getVersion: () => Promise<string>;
  };
  readonly session: {
    readonly getState: () => Promise<OperationsSessionResult>;
    readonly submitPin: (pin: string) => Promise<OperationsSessionResult>;
    readonly signOut: () => Promise<OperationsSessionResult>;
  };
  readonly orders: TuxOrdersApi;
  readonly ordersBoard: TuxOrdersBoardApi;
  readonly expenses: TuxExpensesApi;
  readonly bulkStock: TuxBulkStockApi;
  readonly endDay: TuxEndDayApi;
}
