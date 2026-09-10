import { createHmac, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

const HASH_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const PIN_PATTERN = /^\d{4,12}$/;

function requireValidPin(pin: string): string {
  if (!PIN_PATTERN.test(pin)) throw new Error('invalid_pin_format');
  return pin;
}

function parseHex(value: string): Buffer | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  return Buffer.from(value, 'hex');
}

export async function hashPin(pin: string): Promise<string> {
  requireValidPin(pin);
  const salt = randomBytes(SALT_BYTES);
  const digest = await pbkdf2(pin, salt, PBKDF2_ITERATIONS, DERIVED_KEY_BYTES, 'sha256');
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export async function verifyPin(pin: string, encodedHash: string): Promise<boolean> {
  if (!PIN_PATTERN.test(pin)) return false;

  const [prefix, iterationText, saltHex, digestHex, ...rest] = encodedHash.split('$');
  if (
    prefix !== HASH_PREFIX ||
    iterationText === undefined ||
    saltHex === undefined ||
    digestHex === undefined ||
    rest.length !== 0
  ) {
    return false;
  }

  const iterations = Number(iterationText);
  const salt = parseHex(saltHex);
  const expected = parseHex(digestHex);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    salt === null ||
    salt.length < SALT_BYTES ||
    expected === null ||
    expected.length !== DERIVED_KEY_BYTES
  ) {
    return false;
  }

  const actual = await pbkdf2(pin, salt, iterations, expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}

export async function pinLookupHash(pin: string, secret: string): Promise<string> {
  requireValidPin(pin);
  if (secret.trim().length < 16) throw new Error('pin_lookup_secret_too_short');
  return createHmac('sha256', secret).update(`tux-admin-pin-v1:${pin}`).digest('hex');
}

export const ADMIN_PIN_HASH_ITERATIONS = PBKDF2_ITERATIONS;
