export type WhatsAppNotificationKind = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION';

export interface WhatsAppNotificationMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly kind: WhatsAppNotificationKind;
  readonly preview: string | null;
  readonly customerName: string | null;
}

export interface WhatsAppNotificationContext {
  readonly sessionActive: boolean;
  readonly focusedConversationId: string | null;
  readonly windowFocused: boolean;
}

export interface WhatsAppNotificationPresentation {
  readonly title: string;
  readonly body: string;
}

const KIND_FALLBACKS: Readonly<Record<WhatsAppNotificationKind, string>> = {
  TEXT: 'New WhatsApp message',
  IMAGE: 'Image message',
  DOCUMENT: 'Document message',
  AUDIO: 'Voice / audio message',
  LOCATION: 'Location message',
};

export function notificationPresentation(
  message: WhatsAppNotificationMessage,
  context: WhatsAppNotificationContext,
): WhatsAppNotificationPresentation | null {
  if (context.windowFocused && context.focusedConversationId === message.conversationId) {
    return null;
  }

  if (!context.sessionActive) {
    return { title: 'TUX', body: 'New WhatsApp message' };
  }

  const preview = message.preview?.trim();
  return {
    title: message.customerName?.trim() || 'WhatsApp',
    body: preview || KIND_FALLBACKS[message.kind],
  };
}

export class WhatsAppNotifications {
  readonly #seen = new Set<string>();
  readonly #getContext: () => WhatsAppNotificationContext;
  readonly #show: (presentation: WhatsAppNotificationPresentation) => void;
  readonly #reportError: (error: unknown) => void;

  constructor(input: {
    readonly getContext: () => WhatsAppNotificationContext;
    readonly show: (presentation: WhatsAppNotificationPresentation) => void;
    readonly reportError?: (error: unknown) => void;
  }) {
    this.#getContext = input.getContext;
    this.#show = input.show;
    this.#reportError = input.reportError ?? (() => undefined);
  }

  observe(message: WhatsAppNotificationMessage): void {
    if (this.#seen.has(message.messageId)) return;
    this.#seen.add(message.messageId);

    const presentation = notificationPresentation(message, this.#getContext());
    if (presentation === null) return;

    try {
      this.#show(presentation);
    } catch (error) {
      this.#reportError(error);
    }
  }
}
