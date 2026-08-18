import type {
  ApplicationErrorCode,
  OperationsOrdersService,
  OrderPlacementResult,
  OrdersWorkspaceResult,
} from '@tux/application';

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

type SaveDraftResult = Awaited<ReturnType<OperationsOrdersService['saveDraft']>>;
type CustomerLookupResult = Awaited<ReturnType<OperationsOrdersService['findCustomerByPhone']>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isApplicationError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value['code'] === 'string' &&
    ERROR_CODES.has(value['code'] as ApplicationErrorCode) &&
    typeof value['message'] === 'string'
  );
}

function isOrderDraft(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const delivery = value['delivery'];
  const payment = value['payment'];
  return (
    isEntityId(value['shopId']) &&
    isEntityId(value['businessDayId']) &&
    typeof value['draftScopeId'] === 'string' &&
    value['draftScopeId'].length > 0 &&
    isSafeInteger(value['revision']) &&
    typeof value['updatedAt'] === 'string' &&
    typeof value['checkoutIntentKey'] === 'string' &&
    value['checkoutIntentKey'].length > 0 &&
    Array.isArray(value['lines']) &&
    isSafeInteger(value['discountMinor']) &&
    isRecord(delivery) &&
    isRecord(payment) &&
    typeof payment['mode'] === 'string'
  );
}

function assertResult<Result>(
  value: unknown,
  success: (payload: unknown) => boolean,
  label: string,
): Result {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new TypeError(`Invalid ${label} response from Electron main process.`);
  }
  if (value['ok'] === true && success(value['value'])) {
    return value as unknown as Result;
  }
  if (value['ok'] === false && isApplicationError(value['error'])) {
    return value as unknown as Result;
  }
  throw new TypeError(`Invalid ${label} response from Electron main process.`);
}

export function assertOrdersWorkspaceResult(value: unknown): OrdersWorkspaceResult {
  return assertResult<OrdersWorkspaceResult>(
    value,
    (payload) => {
      if (!isRecord(payload)) return false;
      const operator = payload['operator'];
      const configuration = payload['configuration'];
      return (
        isEntityId(payload['shopId']) &&
        isEntityId(payload['businessDayId']) &&
        isRecord(configuration) &&
        Array.isArray(configuration['categories']) &&
        Array.isArray(configuration['products']) &&
        Array.isArray(configuration['orderTypes']) &&
        Array.isArray(configuration['paymentMethods']) &&
        Array.isArray(configuration['deliveryZones']) &&
        isRecord(operator) &&
        isEntityId(operator['id']) &&
        typeof operator['displayName'] === 'string' &&
        isOrderDraft(payload['draft'])
      );
    },
    'Orders workspace',
  );
}

export function assertSaveDraftResult(value: unknown): SaveDraftResult {
  return assertResult<SaveDraftResult>(value, isOrderDraft, 'order draft save');
}

export function assertCustomerLookupResult(value: unknown): CustomerLookupResult {
  return assertResult<CustomerLookupResult>(
    value,
    (payload) =>
      payload === null ||
      (isRecord(payload) &&
        isEntityId(payload['id']) &&
        isEntityId(payload['shopId']) &&
        typeof payload['normalizedPhone'] === 'string' &&
        typeof payload['name'] === 'string'),
    'customer lookup',
  );
}

export function assertOrderPlacementResult(value: unknown): OrderPlacementResult {
  return assertResult<OrderPlacementResult>(
    value,
    (payload) => {
      if (!isRecord(payload) || typeof payload['replayed'] !== 'boolean') return false;
      const order = payload['order'];
      return (
        isRecord(order) &&
        isEntityId(order['id']) &&
        isEntityId(order['businessDayId']) &&
        isSafeInteger(order['displayOrderNo']) &&
        order['displayOrderNo'] > 0 &&
        isSafeInteger(order['totalMinor']) &&
        isOrderDraft(payload['nextDraft']) &&
        Array.isArray(payload['postCommitWarnings']) &&
        payload['postCommitWarnings'].every((warning) => typeof warning === 'string')
      );
    },
    'order placement',
  );
}
