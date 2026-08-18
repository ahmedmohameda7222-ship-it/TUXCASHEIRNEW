import type {
  AuditEvent,
  BusinessDayId,
  ExpenseId,
  ExpenseLedgerRecord,
  ManualExpenseRecord,
  OutboxEvent,
  WorkerId,
} from '@tux/domain';

export interface ExpenseLedgerMutation {
  readonly action: 'CREATE' | 'UPDATE';
  readonly expectedBusinessDayId: BusinessDayId;
  readonly expectedWorkerId: WorkerId;
  readonly expectedRevision: number | null;
  readonly expense: ManualExpenseRecord;
  readonly audit: AuditEvent;
  readonly outbox: OutboxEvent;
}

export interface ExpenseLedgerStore {
  initialize(): Promise<void>;
  getById(id: ExpenseId): Promise<ExpenseLedgerRecord | null>;
  listByBusinessDay(businessDayId: BusinessDayId): Promise<readonly ExpenseLedgerRecord[]>;
  commitMutation(mutation: ExpenseLedgerMutation): Promise<void>;
  close(): Promise<void>;
}
