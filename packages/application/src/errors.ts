export type ApplicationErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_DRAFT'
  | 'LOCAL_PERSISTENCE_ERROR'
  | 'PRINT_ERROR'
  | 'REMOTE_SYNC_ERROR'
  | 'PIN_AUTH_ERROR'
  | 'CONFLICT_ERROR'
  | 'NOT_FOUND'
  | 'ALREADY_CLOSED'
  | 'IDEMPOTENCY_REPLAY';

export interface ApplicationError {
  readonly code: ApplicationErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}