import type { ApplicationErrorCode } from '@tux/application';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';

type MediaAccessResult = Awaited<ReturnType<TuxWhatsAppApi['getMediaAccess']>>;

const ERROR_CODES = new Set<ApplicationErrorCode>([
  'VALIDATION_ERROR',
  'INVALID_DRAFT',
  'LOCAL_PERSISTENCE_ERROR',
  'PRINT_ERROR',
  'REMOTE_SYNC_ERROR',
  'PIN_AUTH_ERROR',
  'CONFLICT_ERROR',
  'NOT_FOUND',
  'ALREADY_CLOSED',
  'IDEMPOTENCY_REPLAY',
  'WHATSAPP_FREE_FORM_WINDOW_CLOSED',
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('WhatsApp media access result must be an object.');
  }
  return value as Record<string, unknown>;
}

function exactKeys(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Invalid ${label} fields.`);
  }
}

function parseError(value: unknown) {
  const source = record(value);
  exactKeys(source, ['code', 'message'], 'WhatsApp media access error');
  const code = source['code'];
  if (
    typeof code !== 'string' ||
    !ERROR_CODES.has(code as ApplicationErrorCode) ||
    typeof source['message'] !== 'string'
  ) {
    throw new TypeError('Invalid WhatsApp media access error from Electron main process.');
  }
  return { code: code as ApplicationErrorCode, message: source['message'] };
}

function validInstant(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('Invalid WhatsApp media access expiry.');
  }
  return value;
}

function parseAccess(value: unknown) {
  const source = record(value);
  exactKeys(source, ['availability', 'url', 'expiresAt'], 'WhatsApp media access');
  if (source['availability'] === 'EXPIRED') {
    if (source['url'] !== null) {
      throw new TypeError('Expired WhatsApp media must not expose a URL.');
    }
    return {
      availability: 'EXPIRED' as const,
      url: null,
      expiresAt: validInstant(source['expiresAt']),
    };
  }
  if (source['availability'] !== 'AVAILABLE' || typeof source['url'] !== 'string') {
    throw new TypeError('Invalid WhatsApp media access availability.');
  }
  let url: string;
  try {
    const parsed = new URL(source['url']);
    if (parsed.protocol !== 'https:') throw new TypeError('Signed media URL must use HTTPS.');
    url = parsed.toString();
  } catch {
    throw new TypeError('Invalid WhatsApp signed media URL.');
  }
  const expiresAt = validInstant(source['expiresAt']);
  if (expiresAt === null) {
    throw new TypeError('Available WhatsApp media must have a signed URL expiry.');
  }
  return { availability: 'AVAILABLE' as const, url, expiresAt };
}

export function assertWhatsAppMediaAccessResult(value: unknown): MediaAccessResult {
  const source = record(value);
  if (source['ok'] === true) {
    exactKeys(source, ['ok', 'value'], 'WhatsApp media access result');
    return { ok: true, value: parseAccess(source['value']) } as MediaAccessResult;
  }
  if (source['ok'] === false) {
    exactKeys(source, ['ok', 'error'], 'WhatsApp media access result');
    return { ok: false, error: parseError(source['error']) } as MediaAccessResult;
  }
  throw new TypeError('Invalid WhatsApp media access result from Electron main process.');
}
