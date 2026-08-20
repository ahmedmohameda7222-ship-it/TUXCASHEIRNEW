import { toOperationsSyncEnvelopeV1, type OutboxEvent } from '@tux/domain';
import { OutboxDeliveryError, type OutboxTransport } from './outboxSync';

export interface HttpOutboxTransportOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

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

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new RangeError('Outbox HTTP timeout must be between 1 and 120000 ms.');
  }
  return timeout;
}

function responseFailure(status: number): OutboxDeliveryError {
  const transient = status === 408 || status === 425 || status === 429 || status >= 500;
  return new OutboxDeliveryError(
    `Remote outbox endpoint rejected event with HTTP ${status}.`,
    transient ? 'TRANSIENT' : 'PERMANENT',
    status,
  );
}

export class HttpOutboxTransport implements OutboxTransport {
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: HttpOutboxTransportOptions) {
    this.#endpoint = normalizeEndpoint(options.endpoint);
    this.#headers = options.headers ?? {};
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  async deliver(event: OutboxEvent): Promise<void> {
    let envelope;
    try {
      envelope = toOperationsSyncEnvelopeV1(event);
    } catch (cause) {
      throw new OutboxDeliveryError(
        'Local outbox event does not satisfy the supported Operations sync contract.',
        'PERMANENT',
        null,
        { cause },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetcher(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tux-event-id': event.id,
          'x-tux-idempotency-key': event.idempotencyKey,
          ...this.#headers,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!response.ok) throw responseFailure(response.status);
    } catch (cause) {
      if (cause instanceof OutboxDeliveryError) throw cause;
      if (controller.signal.aborted) {
        throw new OutboxDeliveryError(
          `Remote outbox delivery timed out after ${this.#timeoutMs} ms.`,
          'TRANSIENT',
          null,
          { cause },
        );
      }
      throw new OutboxDeliveryError('Remote outbox network delivery failed.', 'TRANSIENT', null, {
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
