import { parseEntityId, type OrderId } from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

const IPC_WHATSAPP_LOAD_INBOX = 'tux:whatsapp:load-inbox';
const IPC_WHATSAPP_LOAD_CONVERSATION = 'tux:whatsapp:load-conversation';
const IPC_WHATSAPP_SEND_TEXT = 'tux:whatsapp:send-text';
const IPC_WHATSAPP_MARK_UNREAD = 'tux:whatsapp:mark-unread';
const IPC_WHATSAPP_ARCHIVE = 'tux:whatsapp:archive';
const IPC_WHATSAPP_SET_FOLLOW_UP = 'tux:whatsapp:set-follow-up';
const IPC_WHATSAPP_LINK_ORDER = 'tux:whatsapp:link-order';
const IPC_WHATSAPP_SAVE_DRAFT = 'tux:whatsapp:save-draft';
const IPC_WHATSAPP_GET_DRAFT = 'tux:whatsapp:get-draft';

const CHANNELS = [
  IPC_WHATSAPP_LOAD_INBOX,
  IPC_WHATSAPP_LOAD_CONVERSATION,
  IPC_WHATSAPP_SEND_TEXT,
  IPC_WHATSAPP_MARK_UNREAD,
  IPC_WHATSAPP_ARCHIVE,
  IPC_WHATSAPP_SET_FOLLOW_UP,
  IPC_WHATSAPP_LINK_ORDER,
  IPC_WHATSAPP_SAVE_DRAFT,
  IPC_WHATSAPP_GET_DRAFT,
] as const;

function objectPayload(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
  return value as Record<string, unknown>;
}

function conversationId(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('WhatsApp conversation ID must be a string.');
  parseEntityId<OrderId>(value);
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export class WhatsAppIpcRuntime {
  readonly #service: TuxWhatsAppApi;

  constructor(input: { readonly service: TuxWhatsAppApi }) {
    this.#service = input.service;
  }

  register(window: BrowserWindow): void {
    this.close();

    ipcMain.handle(IPC_WHATSAPP_LOAD_INBOX, async (event, cursor: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      if (cursor !== undefined && typeof cursor !== 'string') {
        throw new TypeError('WhatsApp inbox cursor must be a string when provided.');
      }
      return this.#service.loadInbox(cursor);
    });

    ipcMain.handle(IPC_WHATSAPP_LOAD_CONVERSATION, async (event, rawConversationId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.loadConversation(conversationId(rawConversationId));
    });

    ipcMain.handle(IPC_WHATSAPP_SEND_TEXT, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'WhatsApp send text');
      return this.#service.sendText({
        conversationId: conversationId(input['conversationId']),
        outboundIntentKey: nonEmpty(input['outboundIntentKey'], 'WhatsApp outbound intent key'),
        text: nonEmpty(input['text'], 'WhatsApp send text'),
      });
    });

    ipcMain.handle(IPC_WHATSAPP_MARK_UNREAD, async (event, rawConversationId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.markUnread(conversationId(rawConversationId));
    });

    ipcMain.handle(
      IPC_WHATSAPP_ARCHIVE,
      async (event, rawConversationId: unknown, archived: unknown) => {
        assertTrustedIpcSender(event, window.webContents.id);
        if (archived !== undefined && typeof archived !== 'boolean') {
          throw new TypeError('WhatsApp archived flag must be a boolean when provided.');
        }
        return this.#service.archive(conversationId(rawConversationId), archived);
      },
    );

    ipcMain.handle(
      IPC_WHATSAPP_SET_FOLLOW_UP,
      async (event, rawConversationId: unknown, followUp: unknown) => {
        assertTrustedIpcSender(event, window.webContents.id);
        if (typeof followUp !== 'boolean') {
          throw new TypeError('WhatsApp follow-up flag must be a boolean.');
        }
        return this.#service.setFollowUp(conversationId(rawConversationId), followUp);
      },
    );

    ipcMain.handle(IPC_WHATSAPP_LINK_ORDER, async (event, rawInput: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      const input = objectPayload(rawInput, 'WhatsApp link order');
      if (typeof input['orderId'] !== 'string') {
        throw new TypeError('WhatsApp order ID must be a string.');
      }
      if (input['linked'] !== undefined && typeof input['linked'] !== 'boolean') {
        throw new TypeError('WhatsApp linked flag must be a boolean when provided.');
      }
      return this.#service.linkOrder({
        conversationId: conversationId(input['conversationId']),
        orderId: parseEntityId<OrderId>(input['orderId']),
        ...(input['linked'] === undefined ? {} : { linked: input['linked'] }),
      });
    });

    ipcMain.handle(
      IPC_WHATSAPP_SAVE_DRAFT,
      async (event, rawConversationId: unknown, text: unknown) => {
        assertTrustedIpcSender(event, window.webContents.id);
        if (typeof text !== 'string') throw new TypeError('WhatsApp draft text must be a string.');
        return this.#service.saveDraft(conversationId(rawConversationId), text);
      },
    );

    ipcMain.handle(IPC_WHATSAPP_GET_DRAFT, async (event, rawConversationId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.getDraft(conversationId(rawConversationId));
    });
  }

  close(): void {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  }
}
