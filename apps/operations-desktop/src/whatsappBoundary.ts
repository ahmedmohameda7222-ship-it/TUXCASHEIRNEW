import type { WhatsAppOutboundBinary } from '@tux/application';
import type { WhatsAppLocationPayload } from '@tux/domain';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MEDIA_POLICY: Record<
  WhatsAppOutboundBinary['kind'],
  { readonly maxBytes: number; readonly mimeTypes: ReadonlySet<string> }
> = {
  IMAGE: {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: new Set(['image/jpeg', 'image/png']),
  },
  AUDIO: {
    maxBytes: 16 * 1024 * 1024,
    mimeTypes: new Set(['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg']),
  },
  DOCUMENT: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: new Set([
      'text/plain',
      'application/pdf',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]),
  },
};

function objectPayload(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} contains unexpected fields.`);
  }
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or null.`);
  return value;
}

function hasUnsafeFileNameCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      character === '/' ||
      character === '\\' ||
      codePoint === undefined ||
      codePoint < 0x20 ||
      codePoint === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

function safeFileName(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 255 ||
    hasUnsafeFileNameCharacter(value)
  ) {
    throw new TypeError('WhatsApp media filename is unsafe.');
  }
  return value;
}

function media(value: unknown): WhatsAppOutboundBinary {
  const source = objectPayload(value, 'WhatsApp media');
  exactKeys(source, ['kind', 'bytes', 'mimeType', 'fileName'], 'WhatsApp media');

  const kind = source['kind'];
  if (kind !== 'IMAGE' && kind !== 'DOCUMENT' && kind !== 'AUDIO') {
    throw new TypeError('WhatsApp media kind is unsupported.');
  }
  if (!(source['bytes'] instanceof Uint8Array) || source['bytes'].byteLength === 0) {
    throw new TypeError('WhatsApp media bytes must be a non-empty Uint8Array.');
  }
  const mimeType = nonEmpty(source['mimeType'], 'WhatsApp media MIME type').toLowerCase();
  const policy = MEDIA_POLICY[kind];
  if (!policy.mimeTypes.has(mimeType)) {
    throw new TypeError('WhatsApp media MIME type is unsupported.');
  }
  if (source['bytes'].byteLength > policy.maxBytes) {
    throw new TypeError('WhatsApp media exceeds the allowed size.');
  }

  return {
    kind,
    bytes: source['bytes'],
    mimeType,
    fileName: safeFileName(source['fileName']),
  };
}

function location(value: unknown): WhatsAppLocationPayload {
  const source = objectPayload(value, 'WhatsApp location');
  exactKeys(source, ['latitude', 'longitude', 'name', 'address'], 'WhatsApp location');
  const latitude = source['latitude'];
  const longitude = source['longitude'];
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new TypeError('WhatsApp location coordinates are invalid.');
  }
  return {
    latitude,
    longitude,
    name: nullableText(source['name'], 'WhatsApp location name'),
    address: nullableText(source['address'], 'WhatsApp location address'),
  };
}

export function parseWhatsAppSendMediaInput(value: unknown): {
  readonly conversationId: string;
  readonly outboundIntentKey: string;
  readonly media: WhatsAppOutboundBinary;
} {
  const source = objectPayload(value, 'WhatsApp send media');
  exactKeys(source, ['conversationId', 'outboundIntentKey', 'media'], 'WhatsApp send media');
  return {
    conversationId: uuid(source['conversationId'], 'WhatsApp conversation ID'),
    outboundIntentKey: nonEmpty(source['outboundIntentKey'], 'WhatsApp outbound intent key'),
    media: media(source['media']),
  };
}

export function parseWhatsAppSendLocationInput(value: unknown): {
  readonly conversationId: string;
  readonly outboundIntentKey: string;
  readonly location: WhatsAppLocationPayload;
} {
  const source = objectPayload(value, 'WhatsApp send location');
  exactKeys(source, ['conversationId', 'outboundIntentKey', 'location'], 'WhatsApp send location');
  return {
    conversationId: uuid(source['conversationId'], 'WhatsApp conversation ID'),
    outboundIntentKey: nonEmpty(source['outboundIntentKey'], 'WhatsApp outbound intent key'),
    location: location(source['location']),
  };
}

export function parseWhatsAppRetryInput(value: unknown): {
  readonly messageId: string;
  readonly outboundIntentKey: string;
} {
  const source = objectPayload(value, 'WhatsApp retry');
  exactKeys(source, ['messageId', 'outboundIntentKey'], 'WhatsApp retry');
  return {
    messageId: uuid(source['messageId'], 'WhatsApp message ID'),
    outboundIntentKey: nonEmpty(source['outboundIntentKey'], 'WhatsApp outbound intent key'),
  };
}

export function parseWhatsAppMessageId(value: unknown): string {
  return uuid(value, 'WhatsApp message ID');
}
