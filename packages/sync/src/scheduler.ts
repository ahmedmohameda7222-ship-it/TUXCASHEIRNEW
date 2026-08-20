import type { OutboxSyncService, OutboxSyncSummary } from './outboxSync';

export interface AutomaticOutboxSchedulerOptions {
  readonly intervalMs?: number;
  readonly onResult?: (result: OutboxSyncSummary | Error) => void;
}

export class AutomaticOutboxScheduler {
  readonly #service: OutboxSyncService;
  readonly #intervalMs: number;
  readonly #onResult: ((result: OutboxSyncSummary | Error) => void) | undefined;
  #timer: ReturnType<typeof setInterval> | null = null;
  #running = false;

  constructor(service: OutboxSyncService, options: AutomaticOutboxSchedulerOptions = {}) {
    const intervalMs = options.intervalMs ?? 15_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
      throw new RangeError('Automatic sync interval must be at least 1000 ms.');
    }
    this.#service = service;
    this.#intervalMs = intervalMs;
    this.#onResult = options.onResult;
  }

  start(): void {
    if (this.#timer !== null) return;
    void this.#tick();
    this.#timer = setInterval(() => void this.#tick(), this.#intervalMs);
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      this.#onResult?.(await this.#service.syncOnce());
    } catch (error) {
      this.#onResult?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#running = false;
    }
  }
}
