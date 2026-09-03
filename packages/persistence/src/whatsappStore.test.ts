import { describe, expect, it } from 'vitest';
import { whatsappStoreContractVersion } from './whatsappStore';

describe('WhatsAppStore contract', () => {
  it('exposes the v1 local cache contract marker', () => {
    expect(whatsappStoreContractVersion).toBe(1);
  });
});
