import type {
  OperationsBulkStockService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  OperationsSessionResult,
  OperationsWhatsAppService,
} from '@tux/application';
import type {
  CategoryAlignment,
  MenuCategoryId,
  ProductId,
  ProductOrderByCategory,
  SystemAccentColor,
  WorkerMenuLayout,
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

export interface TuxWorkerMenuLayoutApi {
  load(): Promise<WorkerMenuLayout | null>;
  subscribe(listener: (layout: WorkerMenuLayout) => void): () => void;
  updateMenuLayout(input: {
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrderByCategory: ProductOrderByCategory;
  }): Promise<WorkerMenuLayout>;
  resetMenuLayout(): Promise<void>;
}

// Compatibility surface retained for System Color and rollback safety. New Menu Layout
// consumers should use TuxWorkerMenuLayoutApi; legacy menu methods remain callable.
export interface TuxWorkerUiPreferencesApi {
  load(): Promise<WorkerUiPreferences | null>;
  subscribe(listener: (preferences: WorkerUiPreferences) => void): () => void;
  updateMenuLayout(input: {
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
  }): Promise<WorkerUiPreferences>;
  updateAccentColor(accentColor: SystemAccentColor | null): Promise<WorkerUiPreferences>;
  resetMenuLayout(): Promise<void>;
}

export type TuxOrdersApi = Pick<
  OperationsOrdersService,
  | 'loadWorkspace'
  | 'startOrderFromCustomerPrefill'
  | 'restoreParkedDraft'
  | 'discardParkedDraft'
  | 'saveDraft'
  | 'findCustomerByPhone'
  | 'placeOrder'
  | 'reprintOrder'
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

export type TuxWhatsAppApi = Pick<
  OperationsWhatsAppService,
  | 'loadInbox'
  | 'loadConversation'
  | 'resolveCustomerOrderContext'
  | 'sendText'
  | 'markUnread'
  | 'archive'
  | 'setFollowUp'
  | 'linkOrder'
  | 'saveDraft'
  | 'getDraft'
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
  readonly workerMenuLayout: TuxWorkerMenuLayoutApi;
  readonly workerUiPreferences: TuxWorkerUiPreferencesApi;
  readonly orders: TuxOrdersApi;
  readonly ordersBoard: TuxOrdersBoardApi;
  readonly expenses: TuxExpensesApi;
  readonly bulkStock: TuxBulkStockApi;
  readonly endDay: TuxEndDayApi;
  readonly whatsapp: TuxWhatsAppApi;
}
