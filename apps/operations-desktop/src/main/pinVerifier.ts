import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import type { PinVerifier } from '@tux/application';

const HASH_PREFIX = 'pbkdf2-sha256';
const DERIVED_KEY_BYTES = 32;

function parseHash(storedHash: string): {
  readonly iterations: number;
  readonly salt: Buffer;
  readonly digest: Buffer;
} | null {
  const [prefix, iterationsText, saltHex, digestHex, ...rest] = storedHash.split('$');
  if (
    prefix !== HASH_PREFIX ||
    iterationsText === undefined ||
    saltHex === undefined ||
    digestHex === undefined ||
    rest.length !== 0
  ) {
    return null;
  }
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) {
    return null;
  }
  if (!/^[0-9a-f]+$/i.test(saltHex) || saltHex.length % 2 !== 0) {
    return null;
  }
  if (!/^[0-9a-f]+$/i.test(digestHex) || digestHex.length !== DERIVED_KEY_BYTES * 2) {
    return null;
  }
  return {
    iterations,
    salt: Buffer.from(saltHex, 'hex'),
    digest: Buffer.from(digestHex, 'hex'),
  };
}

export class NodePbkdf2PinVerifier implements PinVerifier {
  async verify(pin: string, storedHash: string): Promise<boolean> {
    const parsed = parseHash(storedHash);
    if (parsed === null) {
      return false;
    }
    const candidate = pbkdf2Sync(pin, parsed.salt, parsed.iterations, DERIVED_KEY_BYTES, 'sha256');
    return timingSafeEqual(candidate, parsed.digest);
  }
}
