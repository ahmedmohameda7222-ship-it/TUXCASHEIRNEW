import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./onlineOrderInboxIpc.ts', import.meta.url), 'utf8');

describe('online-order acceptance IPC trust boundary', () => {
  it('accepts only request identity plus worker confirmation and reloads the trusted cached claim', () => {
    expect(source).toContain(
      "exactKeys(input, ['requestId', 'confirmation'], 'Online-order acceptance')",
    );
    expect(source).toContain('this.#acceptanceStore.get(shopId, requestId)');
    expect(source).not.toContain("parseCachedOnlineOrderRequest(input['request'])");
  });
});
