import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppNotifications,
  notificationPresentation,
  type WhatsAppNotificationContext,
  type WhatsAppNotificationMessage,
} from './whatsappNotifications';

const message: WhatsAppNotificationMessage = {
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  createdAt: '2026-09-05T20:30:00.000Z',
  kind: 'TEXT',
  preview: 'Order ready for pickup',
  customerName: 'Mona',
};

function context(
  overrides: Partial<WhatsAppNotificationContext> = {},
): WhatsAppNotificationContext {
  return {
    sessionActive: true,
    focusedConversationId: null,
    windowFocused: false,
    ...overrides,
  };
}

describe('notificationPresentation', () => {
  it('suppresses the focused conversation', () => {
    const focused = context({ windowFocused: true, focusedConversationId: message.conversationId });

    expect(notificationPresentation(message, focused)).toBeNull();
  });

  it('shows a safe preview for an ACTIVE local session', () => {
    expect(notificationPresentation(message, context())).toEqual({
      title: 'Mona',
      body: 'Order ready for pickup',
    });
  });

  it('uses exact generic copy outside an ACTIVE local session', () => {
    const presentation = notificationPresentation(
      {
        ...message,
        preview: 'SECRET MESSAGE PREVIEW',
        customerName: 'SECRET CUSTOMER',
      },
      context({ sessionActive: false }),
    );

    expect(presentation).toEqual({ title: 'TUX', body: 'New WhatsApp message' });
    expect(JSON.stringify(presentation)).not.toContain('SECRET MESSAGE PREVIEW');
    expect(JSON.stringify(presentation)).not.toContain('SECRET CUSTOMER');
  });

  it('uses kind-only fallback copy when preview text is absent', () => {
    const fallbacks = [
      ['IMAGE', 'Image message'],
      ['DOCUMENT', 'Document message'],
      ['AUDIO', 'Voice / audio message'],
      ['LOCATION', 'Location message'],
    ] as const;

    for (const [kind, body] of fallbacks) {
      const presentation = notificationPresentation({ ...message, kind, preview: null }, context());
      expect(presentation).toEqual({ title: 'Mona', body });
    }
  });
});

describe('WhatsAppNotifications', () => {
  it('dedupes a stable message id for the app runtime', () => {
    const show = vi.fn();
    const notifications = new WhatsAppNotifications({
      getContext: () => context(),
      show,
    });

    notifications.observe(message);
    notifications.observe(message);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({ title: 'Mona', body: 'Order ready for pickup' });
  });

  it('does not resurface a message suppressed while focused', () => {
    const show = vi.fn();
    let current = context({ windowFocused: true, focusedConversationId: message.conversationId });
    const notifications = new WhatsAppNotifications({
      getContext: () => current,
      show,
    });

    notifications.observe(message);
    current = context({ windowFocused: false, focusedConversationId: null });
    notifications.observe(message);

    expect(show).not.toHaveBeenCalled();
  });

  it('swallows OS notification failures', () => {
    const reportError = vi.fn();
    const notifications = new WhatsAppNotifications({
      getContext: () => context(),
      show: () => {
        throw new Error('notification subsystem unavailable');
      },
      reportError,
    });

    expect(() => notifications.observe(message)).not.toThrow();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
