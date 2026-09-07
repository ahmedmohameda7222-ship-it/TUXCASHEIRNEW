import { assertWhatsAppMessageInvariant, type WhatsAppMessage } from '@tux/domain';

export function sanitizeWhatsAppMessageForCache(message: WhatsAppMessage): WhatsAppMessage {
  const media = message.media ?? null;
  const location = message.location ?? null;
  const safe: WhatsAppMessage = {
    id: message.id,
    shopId: message.shopId,
    conversationId: message.conversationId,
    providerMessageId: message.providerMessageId,
    outboundIntentKey: message.outboundIntentKey,
    direction: message.direction,
    kind: message.kind,
    text: message.text,
    mediaRef: message.mediaRef,
    media:
      media === null
        ? null
        : {
            mediaKey: media.mediaKey,
            kind: media.kind,
            mimeType: media.mimeType,
            fileName: media.fileName,
            byteSize: media.byteSize,
            storedAt: media.storedAt,
            expiresAt: media.expiresAt,
            availability: media.availability,
          },
    location:
      location === null
        ? null
        : {
            latitude: location.latitude,
            longitude: location.longitude,
            name: location.name,
            address: location.address,
          },
    status: message.status,
    sentByWorkerId: message.sentByWorkerId,
    initiatedByDeviceId: message.initiatedByDeviceId,
    initiatedAt: message.initiatedAt,
    createdAt: message.createdAt,
  };
  assertWhatsAppMessageInvariant(safe);
  return safe;
}
