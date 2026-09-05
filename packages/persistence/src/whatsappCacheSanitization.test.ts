import 'fake-indexeddb/auto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instant, parseEntityId, type ShopId, type WhatsAppMessage } from '@tux/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbWhatsAppStore } from './browser/IndexedDbWhatsAppStore';
import { SqliteWhatsAppStore } from './sqlite/SqliteWhatsAppStore';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const createdIndexedDbNames: string[] = [];
const createdRoots: string[] = [];

const SAFE_MEDIA = {
  mediaKey: 'tux-media-key-1',
  kind: 'IMAGE' as const,
  mimeType: 'image/png',
  fileName: 'receipt.png',
  byteSize: 128,
  storedAt: instant('2026-09-04T12:00:00.000Z'),
  expiresAt: instant('2026-10-04T12:00:00.000Z'),
  availability: 'AVAILABLE' as const,
};

const FORBIDDEN_VALUES = [
  'meta-media-id-1',
  'https://lookaside.fbsbx.com/whatsapp_business/attachments/provider-download',
  'media/11111111-1111-4111-8111-111111111111/internal-object-path',
  'https://example.supabase.co/storage/v1/object/sign/private/signed?token=secret',
  'https://example.supabase.co/storage/v1/object/upload/sign/private/temp-upload',
  'AQIDBA==',
] as const;

function unsafeMessage(): WhatsAppMessage {
  const media = {
    ...SAFE_MEDIA,
    providerMediaId: FORBIDDEN_VALUES[0],
    providerDownloadUrl: FORBIDDEN_VALUES[1],
    objectPath: FORBIDDEN_VALUES[2],
    signedUrl: FORBIDDEN_VALUES[3],
    temporaryUploadUrl: FORBIDDEN_VALUES[4],
  };
  const canonical: WhatsAppMessage = {
    id: MESSAGE_ID,
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
    providerMessageId: 'wamid.message.1',
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'IMAGE',
    text: null,
    mediaRef: SAFE_MEDIA.mediaKey,
    media,
    location: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: instant('2026-09-04T12:00:01.000Z'),
  };
  return {
    ...canonical,
    providerMediaId: FORBIDDEN_VALUES[0],
    providerDownloadUrl: FORBIDDEN_VALUES[1],
    storageObjectPath: FORBIDDEN_VALUES[2],
    signedStorageUrl: FORBIDDEN_VALUES[3],
    temporaryUploadUrl: FORBIDDEN_VALUES[4],
    binaryBlob: FORBIDDEN_VALUES[5],
  } as WhatsAppMessage;
}

function expectCanonicalSafeMessage(message: WhatsAppMessage): void {
  expect(message).toEqual({
    id: MESSAGE_ID,
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
    providerMessageId: 'wamid.message.1',
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'IMAGE',
    text: null,
    mediaRef: SAFE_MEDIA.mediaKey,
    media: SAFE_MEDIA,
    location: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: instant('2026-09-04T12:00:01.000Z'),
  });
  const serialized = JSON.stringify(message);
  for (const forbidden of FORBIDDEN_VALUES) expect(serialized).not.toContain(forbidden);
}

async function deleteIndexedDb(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

afterEach(async () => {
  await Promise.all(createdIndexedDbNames.splice(0).map(deleteIndexedDb));
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('WhatsApp cache sanitization', () => {
  it('persists only the canonical safe message projection in IndexedDB', async () => {
    const databaseName = `tux-whatsapp-cache-sanitization-${crypto.randomUUID()}`;
    createdIndexedDbNames.push(databaseName);
    const store = new IndexedDbWhatsAppStore(databaseName);
    await store.initialize();
    await store.upsertMessage(unsafeMessage());

    const [cached] = await store.listMessages(SHOP_ID, CONVERSATION_ID);
    expect(cached).toBeDefined();
    expectCanonicalSafeMessage(cached!);
    await store.close();
  });

  it('persists only the canonical safe message projection in SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tux-whatsapp-cache-sanitization-'));
    createdRoots.push(root);
    const store = new SqliteWhatsAppStore(join(root, 'cache.sqlite'));
    await store.initialize();
    await store.upsertMessage(unsafeMessage());

    const [cached] = await store.listMessages(SHOP_ID, CONVERSATION_ID);
    expect(cached).toBeDefined();
    expectCanonicalSafeMessage(cached!);
    await store.close();
  });
});
