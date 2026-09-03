import {
  instant,
  type Instant,
  type OrderId,
  type ShopId,
  type WhatsAppMessage,
} from '@tux/domain';
import type { CachedWhatsAppInboxSnapshot, WhatsAppDraft, WhatsAppStore } from '@tux/persistence';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';
import type { OperationsSessionResult } from './session';
import {
  WhatsAppRemoteError,
  type WhatsAppInboxSnapshot,
  type WhatsAppRemoteErrorCode,
  type WhatsAppRemoteGateway,
} from './whatsappRemote';

export interface WhatsAppSessionStateSource {
  getState(): Promise<OperationsSessionResult>;
}

interface ActiveWhatsAppClaims {
  readonly businessDayId: Extract<
    OperationsSessionResult,
    { ok: true }
  >['value'] extends infer State
    ? State extends { status: 'ACTIVE'; businessDayId: infer Id }
      ? Id
      : never
    : never;
  readonly workerId: Extract<OperationsSessionResult, { ok: true }>['value'] extends infer State
    ? State extends { status: 'ACTIVE'; operator: { id: infer Id } }
      ? Id
      : never
    : never;
  readonly shopId: ShopId;
}

function conflict(message: string): ApplicationError {
  return { code: 'CONFLICT_ERROR', message };
}

function localPersistence(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function remoteSync(message: string, cause: unknown): ApplicationError {
  return { code: 'REMOTE_SYNC_ERROR', message, cause };
}

function remoteCode(error: unknown): WhatsAppRemoteErrorCode | null {
  if (error instanceof WhatsAppRemoteError) return error.code;
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return code === 'OPERATOR_NOT_SYNCHRONIZED' ||
    code === 'OUTBOUND_INTENT_CONFLICT' ||
    code === 'DELIVERY_UNCERTAIN' ||
    code === 'REMOTE_UNAVAILABLE'
    ? code
    : null;
}

function mapRemoteError(error: unknown): ApplicationError {
  const code = remoteCode(error);
  if (code === 'OPERATOR_NOT_SYNCHRONIZED') {
    return conflict('WhatsApp Current Operator is not synchronized.');
  }
  if (code === 'OUTBOUND_INTENT_CONFLICT') {
    return conflict('WhatsApp outbound intent conflicts with an existing message.');
  }
  if (code === 'DELIVERY_UNCERTAIN') {
    return remoteSync('WhatsApp delivery is not confirmed yet.', error);
  }
  return remoteSync('WhatsApp remote operation failed.', error);
}

function withCursor(snapshot: CachedWhatsAppInboxSnapshot): WhatsAppInboxSnapshot {
  return { ...snapshot, nextCursor: null };
}

export class OperationsWhatsAppService {
  readonly #remote: WhatsAppRemoteGateway;
  readonly #store: WhatsAppStore;
  readonly #session: WhatsAppSessionStateSource;
  readonly #now: () => Instant;

  constructor(
    remote: WhatsAppRemoteGateway,
    store: WhatsAppStore,
    session: WhatsAppSessionStateSource,
    now: () => Instant = () => instant(new Date()),
  ) {
    this.#remote = remote;
    this.#store = store;
    this.#session = session;
    this.#now = now;
  }

  async loadInbox(cursor?: string): Promise<Result<WhatsAppInboxSnapshot, ApplicationError>> {
    const state = await this.#readSession();
    const localShopId = state.ok ? this.#shopId(state.value) : null;

    try {
      const snapshot = await this.#remote.loadInbox(cursor);
      try {
        await this.#store.upsertRemoteSnapshot(snapshot);
      } catch (cause) {
        return err(localPersistence('Could not cache the WhatsApp inbox.', cause));
      }
      return ok(snapshot);
    } catch (cause) {
      if (remoteCode(cause) === 'REMOTE_UNAVAILABLE' && localShopId !== null) {
        try {
          return ok(withCursor(await this.#store.loadInbox(localShopId)));
        } catch (cacheCause) {
          return err(localPersistence('Could not read the cached WhatsApp inbox.', cacheCause));
        }
      }
      return err(mapRemoteError(cause));
    }
  }

  async loadConversation(
    conversationId: string,
  ): Promise<Result<readonly WhatsAppMessage[], ApplicationError>> {
    const shop = await this.#resolveLocalShop();
    if (!shop.ok) return shop;
    try {
      return ok(await this.#store.listMessages(shop.value, conversationId));
    } catch (cause) {
      return err(localPersistence('Could not read the cached WhatsApp conversation.', cause));
    }
  }

  async sendText(input: {
    readonly conversationId: string;
    readonly text: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>> {
    const claims = await this.#resolveActiveClaims();
    if (!claims.ok) return claims;

    let message: WhatsAppMessage;
    try {
      message = await this.#remote.sendText({
        businessDayId: claims.value.businessDayId,
        workerId: claims.value.workerId,
        conversationId: input.conversationId,
        outboundIntentKey: input.outboundIntentKey,
        text: input.text,
      });
    } catch (cause) {
      return err(mapRemoteError(cause));
    }

    try {
      await this.#store.upsertMessage(message);
    } catch (cause) {
      return err(
        localPersistence(
          'WhatsApp message was sent remotely but could not be written to the local cache.',
          cause,
        ),
      );
    }
    return ok(message);
  }

  async markUnread(conversationId: string): Promise<Result<void, ApplicationError>> {
    return this.#remoteMutation(() => this.#remote.markUnread(conversationId));
  }

  async archive(
    conversationId: string,
    archived?: boolean,
  ): Promise<Result<void, ApplicationError>> {
    return this.#remoteMutation(() => this.#remote.archive(conversationId, archived));
  }

  async setFollowUp(
    conversationId: string,
    followUp: boolean,
  ): Promise<Result<void, ApplicationError>> {
    return this.#remoteMutation(() => this.#remote.setFollowUp(conversationId, followUp));
  }

  async linkOrder(input: {
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked?: boolean;
  }): Promise<Result<void, ApplicationError>> {
    const claims = await this.#resolveActiveClaims();
    if (!claims.ok) return claims;
    try {
      await this.#remote.linkOrder({
        businessDayId: claims.value.businessDayId,
        workerId: claims.value.workerId,
        conversationId: input.conversationId,
        orderId: input.orderId,
        ...(input.linked === undefined ? {} : { linked: input.linked }),
      });
      return ok(undefined);
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async saveDraft(conversationId: string, text: string): Promise<Result<void, ApplicationError>> {
    const shop = await this.#resolveLocalShop();
    if (!shop.ok) return shop;
    const draft: WhatsAppDraft = {
      shopId: shop.value,
      conversationId,
      text,
      updatedAt: this.#now(),
    };
    try {
      await this.#store.saveDraft(draft);
      return ok(undefined);
    } catch (cause) {
      return err(localPersistence('Could not save the WhatsApp draft.', cause));
    }
  }

  async getDraft(conversationId: string): Promise<Result<WhatsAppDraft | null, ApplicationError>> {
    const shop = await this.#resolveLocalShop();
    if (!shop.ok) return shop;
    try {
      return ok(await this.#store.getDraft(shop.value, conversationId));
    } catch (cause) {
      return err(localPersistence('Could not read the WhatsApp draft.', cause));
    }
  }

  async #remoteMutation(operation: () => Promise<void>): Promise<Result<void, ApplicationError>> {
    try {
      await operation();
      return ok(undefined);
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async #resolveActiveClaims(): Promise<Result<ActiveWhatsAppClaims, ApplicationError>> {
    const state = await this.#readSession();
    if (!state.ok) return state;
    if (state.value.status !== 'ACTIVE') {
      return err(conflict('An active Current Operator is required for this WhatsApp operation.'));
    }
    return ok({
      businessDayId: state.value.businessDayId,
      workerId: state.value.operator.id,
      shopId: state.value.shopId,
    });
  }

  async #resolveLocalShop(): Promise<Result<ShopId, ApplicationError>> {
    const state = await this.#readSession();
    if (!state.ok) return state;
    const shopId = this.#shopId(state.value);
    return shopId === null
      ? err(conflict('A resolved Operations shop is required for this WhatsApp operation.'))
      : ok(shopId);
  }

  async #readSession(): Promise<OperationsSessionResult> {
    try {
      return await this.#session.getState();
    } catch (cause) {
      return err(localPersistence('Could not read the current Operations session.', cause));
    }
  }

  #shopId(state: Extract<OperationsSessionResult, { ok: true }>['value']): ShopId | null {
    return state.status === 'CONFIGURATION_REQUIRED' ? null : state.shopId;
  }
}
