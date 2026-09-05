import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_MEDIA_LIMITS,
  WHATSAPP_MEDIA_MIME_TYPES,
  validateWhatsAppMediaContent,
} from './whatsappMediaPolicy';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('WhatsApp media policy', () => {
  it('freezes the approved v1 MIME allowlist and exact size limits', () => {
    expect(WHATSAPP_MEDIA_LIMITS).toEqual({
      IMAGE: 5 * 1024 * 1024,
      AUDIO: 16 * 1024 * 1024,
      DOCUMENT: 100 * 1024 * 1024,
    });
    expect(WHATSAPP_MEDIA_MIME_TYPES.IMAGE).toEqual(['image/jpeg', 'image/png']);
    expect(WHATSAPP_MEDIA_MIME_TYPES.IMAGE).not.toContain('image/webp');
    expect(WHATSAPP_MEDIA_MIME_TYPES.AUDIO).toContain('audio/ogg');
    expect(WHATSAPP_MEDIA_MIME_TYPES.DOCUMENT).toContain('application/pdf');
  });

  it.each([
    ['IMAGE', 'image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['IMAGE', 'image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['DOCUMENT', 'application/pdf', new TextEncoder().encode('%PDF-1.7\n')],
  ] as const)('accepts valid %s content signatures', (kind, mimeType, prefix) => {
    expect(
      validateWhatsAppMediaContent({
        kind,
        mimeType,
        byteSize: prefix.byteLength,
        prefix,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts the exact size limit and rejects limit + 1 without allocating the full payload', () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
    expect(
      validateWhatsAppMediaContent({
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        byteSize: WHATSAPP_MEDIA_LIMITS.IMAGE,
        prefix: jpeg,
      }),
    ).toEqual({ ok: true });
    expect(
      validateWhatsAppMediaContent({
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        byteSize: WHATSAPP_MEDIA_LIMITS.IMAGE + 1,
        prefix: jpeg,
      }),
    ).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('rejects MIME/content mismatches, WebP image messages, arbitrary OGG, and NUL-heavy text', () => {
    expect(
      validateWhatsAppMediaContent({
        kind: 'IMAGE',
        mimeType: 'image/png',
        byteSize: 4,
        prefix: bytes(0xff, 0xd8, 0xff, 0xe0),
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateWhatsAppMediaContent({
        kind: 'IMAGE',
        mimeType: 'image/webp',
        byteSize: 12,
        prefix: new TextEncoder().encode('RIFFxxxxWEBP'),
      }),
    ).toMatchObject({ ok: false, code: 'MIME_NOT_ALLOWED' });
    expect(
      validateWhatsAppMediaContent({
        kind: 'AUDIO',
        mimeType: 'audio/ogg',
        byteSize: 16,
        prefix: new TextEncoder().encode('OggSxxxxVorbisxx'),
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateWhatsAppMediaContent({
        kind: 'DOCUMENT',
        mimeType: 'text/plain',
        byteSize: 8,
        prefix: bytes(0x61, 0, 0, 0, 0, 0, 0, 0),
      }),
    ).toMatchObject({ ok: false });
  });

  it('accepts OGG only when the bounded probe establishes Opus', () => {
    expect(
      validateWhatsAppMediaContent({
        kind: 'AUDIO',
        mimeType: 'audio/ogg',
        byteSize: 24,
        prefix: new TextEncoder().encode('OggS00000000OpusHead0000'),
      }),
    ).toEqual({ ok: true });
  });
});
