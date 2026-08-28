import type {
  OperationsBulkStockService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  OperationsSessionResult,
} from '@tux/application';
import type {
  CategoryAlignment,
  MenuCategoryId,
  ProductId,
  WorkerUiPreferences,
} from '@tux/domain';

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

export interface TuxSyncApi {
  readonly getStatus: () => Promise<TuxSyncHealthSnapshot>;
  readonly subscribe: (listener: (snapshot: TuxSyncHealthSnapshot) => void) => () => void;
}

export interface TuxWorkerUiPreferencesApi {
  load(): Promise<WorkerUiPreferences | null>;
  update(input: {
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
  }): Promise<WorkerUiPreferences>;
  reset(): Promise<void>;
}

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
  readonly sync: TuxSyncApi;
  readonly workerUiPreferences: TuxWorkerUiPreferencesApi;
  readonly orders: TuxOrdersApi;
  readonly ordersBoard: TuxOrdersBoardApi;
  readonly expenses: TuxExpensesApi;
  readonly bulkStock: TuxBulkStockApi;
  readonly endDay: TuxEndDayApi;
}
