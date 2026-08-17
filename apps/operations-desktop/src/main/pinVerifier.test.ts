import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NodePbkdf2PinVerifier } from './pinVerifier';

function fixtureHash(pin: string): string {
  const iterations = 120_000;
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

describe('NodePbkdf2PinVerifier', () => {
  it('accepts the matching PIN and rejects a different PIN', async () => {
    const verifier = new NodePbkdf2PinVerifier();
    const storedHash = fixtureHash('1234');
    await expect(verifier.verify('1234', storedHash)).resolves.toBe(true);
    await expect(verifier.verify('4321', storedHash)).resolves.toBe(false);
  });

  it('fails closed for malformed or weak stored hashes', async () => {
    const verifier = new NodePbkdf2PinVerifier();
    await expect(verifier.verify('1234', 'plaintext:1234')).resolves.toBe(false);
    await expect(
      verifier.verify('1234', `pbkdf2-sha256$99999$0011223344556677$${'00'.repeat(32)}`),
    ).resolves.toBe(false);
  });
});
