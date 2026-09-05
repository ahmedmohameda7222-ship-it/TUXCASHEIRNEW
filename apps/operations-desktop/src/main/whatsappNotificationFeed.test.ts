import { describe, expect, it, vi } from 'vitest';
import { WhatsAppNotificationFeed, type WhatsAppNotificationEnvelope } from './whatsappNotificationFeed';
import { WhatsAppNotifications, type WhatsAppNotificationContext } from './whatsappNotifications';

const message = {
  messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  createdAt: '2026-09-05T20:30:00.000Z',
  kind: 'TEXT' as const,
  preview: 'Order ready for pickup',
  customerName: 'Mona',
};

function envelope(cursor: string | null): WhatsAppNotificationEnvelope {
  return { cursor, messages: [message] };
}

function activeContext(
  overrides: Partial<WhatsAppNotificationContext> = {},
): WhatsAppNotificationContext {
  return {
    sessionActive: true,
    focusedConversationId: null,
    windowFocused: false,
    ...overrides,
  };
}

describe('WhatsAppNotificationFeed', () => {
  it('advances the server cursor between polls', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(envelope('cursor-1'))
      .mockResolvedValueOnce({ cursor: 'cursor-2', messages: [] });
    const feed = new WhatsAppNotificationFeed({
      load,
      notifications: { observe: vi.fn() },
      isSessionActive: () => true,
    });

    await feed.pollOnce();
    await feed.pollOnce();

    expect(load.mock.calls).toEqual([[null], ['cursor-1']]);
  });

  it('dedupes a repeated server envelope through the runtime notification policy', async () => {
    const show = vi.fn();
    const notifications = new WhatsAppNotifications({
      getContext: () => activeContext(),
      show,
    });
    const feed = new WhatsAppNotificationFeed({
      load: vi.fn().mockResolvedValue(envelope('same-cursor')),
      notifications,
      isSessionActive: () => true,
    });

    await feed.pollOnce();
    await feed.pollOnce();

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('keeps transport failure nonfatal and preserves the previous cursor', async () => {
    const reportError = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ cursor: 'cursor-1', messages: [] });
    const feed = new WhatsAppNotificationFeed({
      load,
      notifications: { observe: vi.fn() },
      isSessionActive: () => true,
      reportError,
    });

    await expect(feed.pollOnce()).resolves.toBeUndefined();
    await feed.pollOnce();

    expect(load.mock.calls).toEqual([[null], [null]]);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('strips customer and preview metadata before observing when the local session is inactive', async () => {
    const observe = vi.fn();
    const feed = new WhatsAppNotificationFeed({
      load: vi.fn().mockResolvedValue(envelope('cursor-1')),
      notifications: { observe },
      isSessionActive: () => false,
    });

    await feed.pollOnce();

    expect(observe).toHaveBeenCalledWith({
      ...message,
      preview: null,
      customerName: null,
    });
  });

  it('uses a 15 second cadence and stops the timer cleanly', () => {
    const scheduled: Array<() => void> = [];
    const clearInterval = vi.fn();
    const setInterval = vi.fn((callback: () => void, delayMs: number) => {
      scheduled.push(callback);
      expect(delayMs).toBe(15_000);
      return 42;
    });
    const load = vi.fn().mockResolvedValue({ cursor: null, messages: [] });
    const feed = new WhatsAppNotificationFeed({
      load,
      notifications: { observe: vi.fn() },
      isSessionActive: () => true,
      scheduler: { setInterval, clearInterval },
    });

    feed.start();
    feed.start();
    feed.stop();
    feed.stop();

    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(clearInterval).toHaveBeenCalledWith(42);
  });
});
