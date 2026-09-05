import { expect, it } from 'vitest';
import type { WhatsAppRemoteGateway } from './whatsappRemote';

it('defines a provider-agnostic WhatsApp remote contract including Task 9C capabilities', () => {
  const fake: WhatsAppRemoteGateway = {
    loadInbox: async () => ({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    resolveMessagingTarget: async () => {
      throw new Error('not called');
    },
    sendText: async () => {
      throw new Error('not called');
    },
    sendTemplate: async () => {
      throw new Error('not called');
    },
    sendMedia: async () => {
      throw new Error('not called');
    },
    sendLocation: async () => {
      throw new Error('not called');
    },
    retryFailedMessage: async () => {
      throw new Error('not called');
    },
    getMediaAccess: async () => {
      throw new Error('not called');
    },
    markUnread: async () => undefined,
    archive: async () => undefined,
    setFollowUp: async () => undefined,
    linkOrder: async () => undefined,
  };

  expect(fake).toBeDefined();
});
