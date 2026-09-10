import { describe, expect, it } from 'vitest';

import { hashPin, pinLookupHash, verifyPin } from './pin';

describe('Admin PIN security', () => {
  it('hashes with salted PBKDF2-SHA256 at the reviewed work factor', async () => {
    const encoded = await hashPin('482731');
    const [prefix, iterations, saltHex, digestHex] = encoded.split('$');

    expect(prefix).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBeGreaterThanOrEqual(210_000);
    expect(saltHex).toMatch(/^[0-9a-f]{32,}$/);
    expect(digestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(encoded).not.toContain('482731');
    expect(await verifyPin('482731', encoded)).toBe(true);
    expect(await verifyPin('482732', encoded)).toBe(false);
  });

  it('creates a deterministic server-secret HMAC lookup without exposing the PIN', async () => {
    const first = await pinLookupHash('482731', 'test-secret-with-enough-entropy');
    const second = await pinLookupHash('482731', 'test-secret-with-enough-entropy');
    const different = await pinLookupHash('482732', 'test-secret-with-enough-entropy');

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('482731');
  });

  it('rejects malformed Admin PIN input', async () => {
    await expect(hashPin('12ab')).rejects.toThrow(/pin/i);
    await expect(pinLookupHash('123', 'test-secret-with-enough-entropy')).rejects.toThrow(/pin/i);
  });
});
