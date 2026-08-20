import type { ApplicationErrorCode, OperationsSessionResult } from '@tux/application';

const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ERROR_CODES = new Set<ApplicationErrorCode>([
  'VALIDATION_ERROR',
  'LOCAL_PERSISTENCE_ERROR',
  'PRINT_ERROR',
  'REMOTE_SYNC_ERROR',
  'PIN_AUTH_ERROR',
  'CONFLICT_ERROR',
  'NOT_FOUND',
  'ALREADY_CLOSED',
  'IDEMPOTENCY_REPLAY',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isApplicationError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value['code'] === 'string' &&
    ERROR_CODES.has(value['code'] as ApplicationErrorCode) &&
    typeof value['message'] === 'string'
  );
}

function isSessionState(value: unknown): boolean {
  if (!isRecord(value) || typeof value['status'] !== 'string') return false;

  switch (value['status']) {
    case 'CONFIGURATION_REQUIRED':
      return typeof value['message'] === 'string';
    case 'NO_ACTIVE_DAY':
      return isEntityId(value['shopId']);
    case 'SIGN_IN_REQUIRED':
      return (
        isEntityId(value['shopId']) &&
        isEntityId(value['businessDayId']) &&
        isInstant(value['businessDayStartedAt'])
      );
    case 'ACTIVE': {
      const operator = value['operator'];
      return (
        isEntityId(value['shopId']) &&
        isEntityId(value['businessDayId']) &&
        isInstant(value['businessDayStartedAt']) &&
        isRecord(operator) &&
        isEntityId(operator['id']) &&
        typeof operator['displayName'] === 'string' &&
        operator['displayName'].trim().length > 0
      );
    }
    default:
      return false;
  }
}

export function assertSessionResult(value: unknown): OperationsSessionResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new TypeError('Invalid session response from Electron main process.');
  }

  if (value['ok'] === true && isSessionState(value['value'])) {
    return value as unknown as OperationsSessionResult;
  }
  if (value['ok'] === false && isApplicationError(value['error'])) {
    return value as unknown as OperationsSessionResult;
  }

  throw new TypeError('Invalid session response from Electron main process.');
}
