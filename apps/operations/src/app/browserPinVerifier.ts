import type { PinVerifier } from '@tux/application';

const HASH_PREFIX = 'pbkdf2-sha256';
const DERIVED_KEY_BYTES = 32;

function hexToArrayBuffer(hex: string): ArrayBuffer | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return null;
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(value)) {
      return null;
    }
    bytes[index] = value;
  }
  return buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export class BrowserPbkdf2PinVerifier implements PinVerifier {
  async verify(pin: string, storedHash: string): Promise<boolean> {
    const [prefix, iterationsText, saltHex, digestHex, ...rest] = storedHash.split('$');
    if (
      prefix !== HASH_PREFIX ||
      iterationsText === undefined ||
      saltHex === undefined ||
      digestHex === undefined ||
      rest.length !== 0
    ) {
      return false;
    }
    const iterations = Number(iterationsText);
    const salt = hexToArrayBuffer(saltHex);
    const expectedBuffer = hexToArrayBuffer(digestHex);
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 100_000 ||
      salt === null ||
      expectedBuffer === null ||
      expectedBuffer.byteLength !== DERIVED_KEY_BYTES
    ) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
        key,
        DERIVED_KEY_BYTES * 8,
      ),
    );
    return constantTimeEqual(derived, new Uint8Array(expectedBuffer));
  }
}
