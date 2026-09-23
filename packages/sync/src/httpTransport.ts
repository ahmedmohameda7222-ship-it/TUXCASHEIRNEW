import { toOperationsSyncEnvelopeV1, type OutboxEvent } from '@tux/domain';
import { OutboxDeliveryError, type OutboxTransport } from './outboxSync';

export interface HttpOutboxConflict {
  readonly error: string;
  readonly canonicalStatus: string | null;
  readonly canonicalOperationalRevision: number | null;
}

export interface HttpOutboxTransportOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly headerProvider?: () =>
    Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  readonly beforeDeliver?: (event: OutboxEvent) => void | Promise<void>;
  readonly onConflict?: (event: OutboxEvent, conflict: HttpOutboxConflict) => void | Promise<void>;
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
  readonly #headerProvider:
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>> | null)
    | null;
  readonly #beforeDeliver: ((event: OutboxEvent) => void | Promise<void>) | null;
  readonly #onConflict:
    | ((event: OutboxEvent, conflict: HttpOutboxConflict) => void | Promise<void>)
    | null;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: HttpOutboxTransportOptions) {
    this.#endpoint = normalizeEndpoint(options.endpoint);
    this.#headers = options.headers ?? {};
    this.#headerProvider = options.headerProvider ?? null;
    this.#beforeDeliver = options.beforeDeliver ?? null;
    this.#onConflict = options.onConflict ?? null;
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

    try {
      await this.#beforeDeliver?.(event);
    } catch (cause) {
      throw new OutboxDeliveryError(
        'Canonical order lifecycle preflight is temporarily unavailable.',
        'TRANSIENT',
        null,
        { cause },
      );
    }

    let dynamicHeaders: Readonly<Record<string, string>>;
    try {
      dynamicHeaders = (await this.#headerProvider?.()) ?? {};
    } catch (cause) {
      throw new OutboxDeliveryError(
        'Remote outbox authentication is temporarily unavailable.',
        'TRANSIENT',
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
          ...dynamicHeaders,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 409) {
          let conflict: HttpOutboxConflict = {
            error: 'sync_conflict',
            canonicalStatus: null,
            canonicalOperationalRevision: null,
          };
          try {
            const body = (await response.json()) as Record<string, unknown>;
            conflict = {
              error: typeof body['error'] === 'string' ? body['error'] : 'sync_conflict',
              canonicalStatus:
                typeof body['canonicalStatus'] === 'string' ? body['canonicalStatus'] : null,
              canonicalOperationalRevision:
                typeof body['canonicalOperationalRevision'] === 'number' &&
                Number.isSafeInteger(body['canonicalOperationalRevision'])
                  ? body['canonicalOperationalRevision']
                  : null,
            };
          } catch {
            // A 409 is still a permanent rejected mutation even if the response body is malformed.
          }
          try {
            await this.#onConflict?.(event, conflict);
          } catch {
            // Do not retry a stale mutation forever; periodic convergence remains active.
          }
        }
        throw responseFailure(response.status);
      }
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
