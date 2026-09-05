import type { WhatsAppNotificationMessage } from './whatsappNotifications';

export type { WhatsAppNotificationMessage };

export interface WhatsAppNotificationEnvelope {
  readonly cursor: string | null;
  readonly messages: readonly WhatsAppNotificationMessage[];
}

interface NotificationObserver {
  observe(message: WhatsAppNotificationMessage): void;
}

interface NotificationFeedScheduler {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_SCHEDULER: NotificationFeedScheduler = {
  setInterval(callback, delayMs) {
    return setInterval(callback, delayMs);
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export class WhatsAppNotificationFeed {
  readonly #load: (cursor: string | null) => Promise<WhatsAppNotificationEnvelope>;
  readonly #notifications: NotificationObserver;
  readonly #isSessionActive: () => boolean;
  readonly #reportError: (error: unknown) => void;
  readonly #scheduler: NotificationFeedScheduler;
  #cursor: string | null = null;
  #timer: unknown = null;
  #polling = false;

  constructor(input: {
    readonly load: (cursor: string | null) => Promise<WhatsAppNotificationEnvelope>;
    readonly notifications: NotificationObserver;
    readonly isSessionActive: () => boolean;
    readonly reportError?: (error: unknown) => void;
    readonly scheduler?: NotificationFeedScheduler;
  }) {
    this.#load = input.load;
    this.#notifications = input.notifications;
    this.#isSessionActive = input.isSessionActive;
    this.#reportError = input.reportError ?? (() => undefined);
    this.#scheduler = input.scheduler ?? DEFAULT_SCHEDULER;
  }

  async pollOnce(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      const envelope = await this.#load(this.#cursor);
      this.#cursor = envelope.cursor;
      const sessionActive = this.#isSessionActive();
      for (const message of envelope.messages) {
        this.#notifications.observe(
          sessionActive ? message : { ...message, preview: null, customerName: null },
        );
      }
    } catch (error) {
      this.#reportError(error);
    } finally {
      this.#polling = false;
    }
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = this.#scheduler.setInterval(() => void this.pollOnce(), 15_000);
  }

  stop(): void {
    if (this.#timer === null) return;
    this.#scheduler.clearInterval(this.#timer);
    this.#timer = null;
  }
}
