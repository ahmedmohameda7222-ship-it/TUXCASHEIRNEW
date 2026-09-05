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
  it('suppresses a notification while the focused Operations window is viewing that conversation', () => {
    expect(
      notificationPresentation(
        message,
        context({ windowFocused: true, focusedConversationId: message.conversationId }),
      ),
    ).toBeNull();
  });

  it('allows a privacy-safe customer/text preview only for an ACTIVE local operator session', () => {
    expect(notificationPresentation(message, context())).toEqual({
      title: 'Mona',
      body: 'Order ready for pickup',
    });
  });

  it('renders exact generic-only copy when the local operator session is not ACTIVE', () => {
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

  it.each([
    ['IMAGE', 'Image message'],
    ['DOCUMENT', 'Document message'],
    ['AUDIO', 'Voice / audio message'],
    ['LOCATION', 'Location message'],
  ] as const)(
    'uses safe kind-only fallback copy for %s without preview text',
    (kind, body) => {
      expect(notificationPresentation({ ...message, kind, preview: null }, context())).toEqual({
        title: 'Mona',
        body,
      });
    },
  );
});

describe('WhatsAppNotifications', () => {
  it('notifies a stable message id at most once per app runtime', () => {
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

  it('does not surface a previously suppressed same-conversation message later in the runtime', () => {
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

  it('swallows OS notification failures and reports them without throwing into POS flows', () => {
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
