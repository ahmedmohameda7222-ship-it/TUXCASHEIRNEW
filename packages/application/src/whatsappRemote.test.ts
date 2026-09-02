import { expect, it } from 'vitest';
import type { WhatsAppRemoteGateway } from './whatsappRemote';

it('defines a provider-agnostic WhatsApp remote contract', () => {
  const fake: WhatsAppRemoteGateway = {
    loadInbox: async () => ({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    sendText: async () => {
      throw new Error('not called');
    },
    markUnread: async () => undefined,
    archive: async () => undefined,
    setFollowUp: async () => undefined,
    linkOrder: async () => undefined,
  };
  expect(fake).toBeDefined();
});
