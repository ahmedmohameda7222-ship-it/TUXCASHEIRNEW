import type { OutboxSyncService, OutboxSyncSummary } from './outboxSync';

export interface AutomaticOutboxSchedulerOptions {
  readonly intervalMs?: number;
  readonly onStart?: () => void;
  readonly onResult?: (result: OutboxSyncSummary | Error) => void;
}

export class AutomaticOutboxScheduler {
  readonly #service: OutboxSyncService;
  readonly #intervalMs: number;
  readonly #onStart: (() => void) | undefined;
  readonly #onResult: ((result: OutboxSyncSummary | Error) => void) | undefined;
  #timer: ReturnType<typeof setInterval> | null = null;
  #active = false;
  #running = false;
  #rerunRequested = false;

  constructor(service: OutboxSyncService, options: AutomaticOutboxSchedulerOptions = {}) {
    const intervalMs = options.intervalMs ?? 15_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
      throw new RangeError('Automatic sync interval must be at least 1000 ms.');
    }
    this.#service = service;
    this.#intervalMs = intervalMs;
    this.#onStart = options.onStart;
    this.#onResult = options.onResult;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#timer = setInterval(() => this.trigger(), this.#intervalMs);
    this.trigger();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#active = false;
    this.#rerunRequested = false;
  }

  trigger(): void {
    if (!this.#active) return;
    if (this.#running) {
      this.#rerunRequested = true;
      return;
    }
    void this.#tick();
  }

  async #tick(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      this.#onStart?.();
      const result = await this.#service.syncOnce();
      this.#onResult?.(result);
    } catch (error) {
      this.#onResult?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#running = false;
      if (this.#rerunRequested && this.#active) {
        this.#rerunRequested = false;
        void this.#tick();
      }
    }
  }
}
