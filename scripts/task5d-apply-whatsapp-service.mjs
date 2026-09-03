import { readFile, writeFile } from 'node:fs/promises';

await writeFile(
  'packages/application/src/whatsapp.ts',
  `import { instant, type Instant, type OrderId, type ShopId, type WhatsAppMessage } from '@tux/domain';
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
  readonly businessDayId: Extract<OperationsSessionResult, { ok: true }>['value'] extends infer State
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
        linked: input.linked,
      });
      return ok(undefined);
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async saveDraft(
    conversationId: string,
    text: string,
  ): Promise<Result<void, ApplicationError>> {
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

  async getDraft(
    conversationId: string,
  ): Promise<Result<WhatsAppDraft | null, ApplicationError>> {
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
`,
);

const remotePath = 'packages/application/src/whatsappRemote.ts';
let remote = await readFile(remotePath, 'utf8');
if (!remote.includes('export class WhatsAppRemoteError')) {
  const marker = '\nexport interface WhatsAppInboxOrderLink {';
  remote = remote.replace(
    marker,
    `\nexport type WhatsAppRemoteErrorCode =\n  | 'OPERATOR_NOT_SYNCHRONIZED'\n  | 'OUTBOUND_INTENT_CONFLICT'\n  | 'DELIVERY_UNCERTAIN'\n  | 'REMOTE_UNAVAILABLE';\n\nexport class WhatsAppRemoteError extends Error {\n  constructor(\n    readonly code: WhatsAppRemoteErrorCode,\n    message: string,\n    readonly messageId: string | null = null,\n  ) {\n    super(message);\n    this.name = 'WhatsAppRemoteError';\n  }\n}\n${marker}`,
  );
}
await writeFile(remotePath, remote);

const indexPath = 'packages/application/src/index.ts';
let index = await readFile(indexPath, 'utf8');
if (!index.includes("OperationsWhatsAppService")) {
  index += "export { OperationsWhatsAppService } from './whatsapp';\n";
  index += "export type { WhatsAppSessionStateSource } from './whatsapp';\n";
}
index = index.replace(
  "export type {\n  WhatsAppInboxOrderLink,\n  WhatsAppInboxSnapshot,\n  WhatsAppRemoteGateway,\n} from './whatsappRemote';",
  "export { WhatsAppRemoteError } from './whatsappRemote';\nexport type {\n  WhatsAppInboxOrderLink,\n  WhatsAppInboxSnapshot,\n  WhatsAppRemoteErrorCode,\n  WhatsAppRemoteGateway,\n} from './whatsappRemote';",
);
await writeFile(indexPath, index);

const browserPath = 'apps/operations/src/app/browserWhatsAppRemote.ts';
let browser = await readFile(browserPath, 'utf8');
browser = browser.replace(
  `import type {\n  WhatsAppInboxOrderLink,\n  WhatsAppInboxSnapshot,\n  WhatsAppRemoteGateway,\n} from '@tux/application';`,
  `import {\n  WhatsAppRemoteError,\n  type WhatsAppInboxOrderLink,\n  type WhatsAppInboxSnapshot,\n  type WhatsAppRemoteGateway,\n} from '@tux/application';`,
);
const privateErrorsStart = browser.indexOf('export class WhatsAppOperatorNotSynchronizedError');
const objectStart = browser.indexOf('function object(value: unknown, label: string)');
if (privateErrorsStart >= 0 && objectStart > privateErrorsStart) {
  browser = browser.slice(0, privateErrorsStart) + browser.slice(objectStart);
}
const mapStart = browser.indexOf('function mapRemoteError(status: number, payload: Record<string, unknown>): never {');
const requestStart = browser.indexOf('async function requestJson(', mapStart);
if (mapStart < 0 || requestStart < 0) throw new Error('Could not locate browser remote error mapper.');
browser =
  browser.slice(0, mapStart) +
  `function mapRemoteError(status: number, payload: Record<string, unknown>): never {\n  const code = typeof payload['error'] === 'string' ? payload['error'] : '';\n  if (status === 409 && code === 'whatsapp_operator_not_synchronized') {\n    throw new WhatsAppRemoteError(\n      'OPERATOR_NOT_SYNCHRONIZED',\n      'WhatsApp Current Operator is not synchronized.',\n    );\n  }\n  if (status === 409 && code === 'whatsapp_outbound_intent_conflict') {\n    throw new WhatsAppRemoteError(\n      'OUTBOUND_INTENT_CONFLICT',\n      'WhatsApp outbound intent conflicts with an existing message.',\n    );\n  }\n  if (status === 503 && code === 'whatsapp_delivery_uncertain') {\n    const messageId = requiredString(payload['messageId'], 'WhatsApp uncertain message id');\n    throw new WhatsAppRemoteError(\n      'DELIVERY_UNCERTAIN',\n      'WhatsApp delivery is not confirmed yet.',\n      messageId,\n    );\n  }\n  throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp request failed.');\n}\n\n` +
  browser.slice(requestStart);
browser = browser.replace(
  "    throw new Error('WhatsApp remote is unavailable.');",
  "    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.');",
);
browser = browser.replace(
  "    throw new Error('WhatsApp remote returned an invalid response.');",
  "    throw new WhatsAppRemoteError(\n      'REMOTE_UNAVAILABLE',\n      'WhatsApp remote returned an invalid response.',\n    );",
);
await writeFile(browserPath, browser);

const browserTestPath = 'apps/operations/src/app/browserWhatsAppRemote.test.ts';
let browserTest = await readFile(browserTestPath, 'utf8');
if (!browserTest.includes("WhatsAppRemoteError } from '@tux/application'")) {
  browserTest = "import { WhatsAppRemoteError } from '@tux/application';\n" + browserTest;
}
browserTest = browserTest.replace(
  `import {\n  VercelBrowserWhatsAppRemote,\n  WhatsAppDeliveryUncertainError,\n  WhatsAppOperatorNotSynchronizedError,\n  WhatsAppOutboundIntentConflictError,\n} from './browserWhatsAppRemote';`,
  `import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';`,
);
browserTest = browserTest.replace(
  '    ).rejects.toBeInstanceOf(WhatsAppOperatorNotSynchronizedError);',
  `    ).rejects.toMatchObject({\n      code: 'OPERATOR_NOT_SYNCHRONIZED',\n      message: 'WhatsApp Current Operator is not synchronized.',\n      messageId: null,\n    });`,
);
browserTest = browserTest.replace(
  '    ).rejects.toBeInstanceOf(WhatsAppOutboundIntentConflictError);',
  `    ).rejects.toMatchObject({\n      code: 'OUTBOUND_INTENT_CONFLICT',\n      message: 'WhatsApp outbound intent conflicts with an existing message.',\n      messageId: null,\n    });`,
);
browserTest = browserTest.replace(
  '    expect(thrown).toBeInstanceOf(WhatsAppDeliveryUncertainError);\n    expect((thrown as WhatsAppDeliveryUncertainError).messageId).toBe(messageId);',
  `    expect(thrown).toBeInstanceOf(WhatsAppRemoteError);\n    expect(thrown).toMatchObject({ code: 'DELIVERY_UNCERTAIN', messageId });`,
);
browserTest = browserTest.replace(
  "    expect(Object.keys(thrown as object).sort()).toEqual(['messageId', 'name'].sort());",
  "    expect(Object.keys(thrown as object).sort()).toEqual(['code', 'messageId', 'name'].sort());",
);
await writeFile(browserTestPath, browserTest);
