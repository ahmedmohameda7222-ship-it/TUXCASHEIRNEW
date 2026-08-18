import type { OutboxEvent } from '@tux/domain';
import type { OutboxTransport } from './outboxSync';

export interface HttpOutboxTransportOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetcher?: typeof fetch;
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim();
  if (endpoint.length === 0) throw new TypeError('Outbox sync endpoint is required.');
  const url = new URL(endpoint);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !loopback) {
    throw new TypeError('Outbox sync endpoint must use HTTPS outside loopback development.');
  }
  return url.toString();
}

export class HttpOutboxTransport implements OutboxTransport {
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetcher: typeof fetch;

  constructor(options: HttpOutboxTransportOptions) {
    this.#endpoint = normalizeEndpoint(options.endpoint);
    this.#headers = options.headers ?? {};
    this.#fetcher = options.fetcher ?? fetch;
  }

  async deliver(event: OutboxEvent): Promise<void> {
    const response = await this.#fetcher(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tux-event-id': event.id,
        'x-tux-idempotency-key': event.idempotencyKey,
        ...this.#headers,
      },
      body: JSON.stringify({
        eventId: event.id,
        shopId: event.shopId,
        businessDayId: event.businessDayId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey,
        payloadVersion: event.payloadVersion,
        payload: event.payload,
        createdAt: event.createdAt,
      }),
    });
    if (!response.ok) {
      throw new Error(`Remote outbox endpoint rejected event with HTTP ${response.status}.`);
    }
  }
}
