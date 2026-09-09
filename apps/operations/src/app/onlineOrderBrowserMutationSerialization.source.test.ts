import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('browser online-order mutation serialization source', () => {
  it('shares one keyed application mutation lock across inbox and acceptance services', () => {
    const inbox = readFileSync(
      new URL('../../../../packages/application/src/onlineOrderInbox.ts', import.meta.url),
      'utf8',
    );
    const acceptance = readFileSync(
      new URL('../../../../packages/application/src/onlineOrderAcceptance.ts', import.meta.url),
      'utf8',
    );
    const lock = readFileSync(
      new URL('../../../../packages/application/src/onlineOrderMutationLock.ts', import.meta.url),
      'utf8',
    );

    expect(inbox.match(/onlineOrderMutationLock\.run\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(acceptance).toContain('onlineOrderMutationLock.run(request.requestId');
    expect(lock).toContain('export const onlineOrderMutationLock = new OnlineOrderMutationLock()');
  });
});
