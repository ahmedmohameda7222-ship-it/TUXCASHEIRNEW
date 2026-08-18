import type {
  OperationsOrdersBoardService,
  OperationsOrdersService,
  OperationsSessionResult,
} from '@tux/application';

export type TuxOrdersApi = Pick<
  OperationsOrdersService,
  'loadWorkspace' | 'saveDraft' | 'findCustomerByPhone' | 'placeOrder' | 'reprintOrder'
>;

export type TuxOrdersBoardApi = Pick<
  OperationsOrdersBoardService,
  'loadBoard' | 'markDone' | 'undoDone' | 'cancelOrder' | 'returnDelivery'
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
}
