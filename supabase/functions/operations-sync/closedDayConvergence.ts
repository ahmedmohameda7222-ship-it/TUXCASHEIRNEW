const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ClosedDayConvergenceCandidate {
  readonly eventId: string;
  readonly shopId: string;
  readonly businessDayId: string;
  readonly idempotencyKey: string;
  readonly eventType: 'BUSINESS_DAY_CLOSED';
  readonly payloadVersion: number;
  readonly startedAt: string;
}

export function closedDayConvergenceCandidate(
  message: string,
  envelope: unknown,
  plan: unknown,
): ClosedDayConvergenceCandidate | null {
  if (!message.includes('TUX_BUSINESS_DAY_ALREADY_CLOSED')) return null;
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return null;
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) return null;
  const source = envelope as Record<string, unknown>;
  const planned = plan as Record<string, unknown>;
  if (source['eventType'] !== 'BUSINESS_DAY_CLOSED') return null;
  if (planned['eventType'] !== 'BUSINESS_DAY_CLOSED') return null;
  const payload = source['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const businessDay = (payload as Record<string, unknown>)['businessDay'];
  if (typeof businessDay !== 'object' || businessDay === null || Array.isArray(businessDay)) {
    return null;
  }
  const day = businessDay as Record<string, unknown>;
  const eventId = source['eventId'];
  const shopId = source['shopId'];
  const businessDayId = source['businessDayId'];
  const idempotencyKey = source['idempotencyKey'];
  const payloadVersion = source['payloadVersion'];
  const startedAt = day['startedAt'];
  if (
    typeof eventId !== 'string' ||
    typeof shopId !== 'string' ||
    typeof businessDayId !== 'string' ||
    typeof idempotencyKey !== 'string' ||
    typeof payloadVersion !== 'number' ||
    typeof startedAt !== 'string' ||
    !UUID_PATTERN.test(eventId) ||
    !UUID_PATTERN.test(shopId) ||
    !UUID_PATTERN.test(businessDayId) ||
    day['id'] !== businessDayId ||
    day['shopId'] !== shopId ||
    day['status'] !== 'CLOSED'
  ) {
    return null;
  }
  return {
    eventId,
    shopId,
    businessDayId,
    idempotencyKey,
    eventType: 'BUSINESS_DAY_CLOSED',
    payloadVersion,
    startedAt,
  };
}
