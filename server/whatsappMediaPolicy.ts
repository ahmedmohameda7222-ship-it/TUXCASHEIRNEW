export type WhatsAppMediaKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO';

export const WHATSAPP_MEDIA_LIMITS = {
  IMAGE: 5 * 1024 * 1024,
  AUDIO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
} as const;

export const WHATSAPP_MEDIA_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png'],
  AUDIO: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  DOCUMENT: [
    'text/plain',
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
} as const;

export type WhatsAppMediaValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'MIME_NOT_ALLOWED' | 'TOO_LARGE' | 'CONTENT_MISMATCH' };

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
  return new TextDecoder('latin1').decode(bytes).includes(needle);
}

function validAudio(mimeType: string, prefix: Uint8Array): boolean {
  if (mimeType === 'audio/ogg')
    return startsWith(prefix, [0x4f, 0x67, 0x67, 0x53]) && includesAscii(prefix, 'OpusHead');
  if (mimeType === 'audio/amr') return includesAscii(prefix.slice(0, 6), '#!AMR\n');
  if (mimeType === 'audio/mpeg') {
    return (
      includesAscii(prefix.slice(0, 3), 'ID3') ||
      (prefix[0] === 0xff && ((prefix[1] ?? 0) & 0xe0) === 0xe0)
    );
  }
  if (mimeType === 'audio/mp4')
    return prefix.length >= 8 && includesAscii(prefix.slice(4, 12), 'ftyp');
  if (mimeType === 'audio/aac') return prefix[0] === 0xff && ((prefix[1] ?? 0) & 0xf6) === 0xf0;
  return false;
}

function validDocument(mimeType: string, prefix: Uint8Array): boolean {
  if (mimeType === 'application/pdf') return includesAscii(prefix.slice(0, 5), '%PDF-');
  if (mimeType === 'text/plain') {
    if (prefix.length === 0) return true;
    let nul = 0;
    let controls = 0;
    for (const byte of prefix) {
      if (byte === 0) nul += 1;
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
    }
    return nul === 0 && controls / prefix.length < 0.1;
  }
  const legacy = new Set([
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
  ]);
  if (legacy.has(mimeType)) {
    return startsWith(prefix, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  const ooxmlMarker = mimeType.includes('wordprocessingml')
    ? 'word/'
    : mimeType.includes('spreadsheetml')
      ? 'xl/'
      : mimeType.includes('presentationml')
        ? 'ppt/'
        : null;
  if (ooxmlMarker !== null) {
    return (
      startsWith(prefix, [0x50, 0x4b, 0x03, 0x04]) &&
      includesAscii(prefix, '[Content_Types].xml') &&
      includesAscii(prefix, ooxmlMarker)
    );
  }
  return false;
}

export function validateWhatsAppMediaContent(input: {
  readonly kind: WhatsAppMediaKind;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly prefix: Uint8Array;
}): WhatsAppMediaValidation {
  const allowed = WHATSAPP_MEDIA_MIME_TYPES[input.kind] as readonly string[];
  if (!allowed.includes(input.mimeType)) return { ok: false, code: 'MIME_NOT_ALLOWED' };
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 0 ||
    input.byteSize > WHATSAPP_MEDIA_LIMITS[input.kind]
  ) {
    return { ok: false, code: 'TOO_LARGE' };
  }
  const valid =
    input.kind === 'IMAGE'
      ? input.mimeType === 'image/jpeg'
        ? startsWith(input.prefix, [0xff, 0xd8, 0xff])
        : startsWith(input.prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : input.kind === 'AUDIO'
        ? validAudio(input.mimeType, input.prefix)
        : validDocument(input.mimeType, input.prefix);
  return valid ? { ok: true } : { ok: false, code: 'CONTENT_MISMATCH' };
}
