import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { shouldApplyRemoteMutation, type RemoteTableMutation } from './remoteMaterializer';

const reviewedSha = 'f26b4eb040050226412668d84461dd4697d1069b';
const rawBase = 'https://raw.githubusercontent.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/';

describe('operations-sync deployment dependency provenance', () => {
  it('pins the deployed materializer and its domain imports to the reviewed CAS-capable baseline', () => {
    const importMap = JSON.parse(
      readFileSync(
        new URL('../../../supabase/functions/operations-sync/deno.json', import.meta.url),
        'utf8',
      ),
    ) as { imports: Record<string, string> };

    expect(importMap.imports['@tux/remote-materializer']).toBe(
      `${rawBase}${reviewedSha}/packages/sync/src/remoteMaterializer.ts`,
    );
    expect(importMap.imports['@tux/domain']).toBe(
      `${rawBase}${reviewedSha}/packages/domain/src/index.ts`,
    );

    for (const [specifier, target] of Object.entries(importMap.imports)) {
      if (specifier.startsWith(rawBase) || target.startsWith(rawBase)) {
        expect(specifier.includes(`/${reviewedSha}/`) || specifier === '@tux/domain' ||
          specifier === '@tux/remote-materializer').toBe(true);
        expect(target).toContain(`/${reviewedSha}/`);
      }
    }
  });

  it('requires the previous status and revision before committing an order lifecycle transition', () => {
    const mutation: RemoteTableMutation = {
      table: 'orders',
      mode: 'UPDATE',
      conflictColumns: ['id'],
      row: { id: 'test-order', operational_revision: 1, status: 'DONE' },
      guard: {
        kind: 'COMPARE_AND_SWAP_REVISION',
        column: 'operational_revision',
        incomingRevision: 1,
        expectedRevision: 0,
        statusColumn: 'status',
        expectedStatus: 'ACTIVE',
      },
    };

    expect(shouldApplyRemoteMutation({ operational_revision: 0, status: 'ACTIVE' }, mutation)).toBe(
      true,
    );
    expect(shouldApplyRemoteMutation({ operational_revision: 1, status: 'DONE' }, mutation)).toBe(
      false,
    );
    expect(
      shouldApplyRemoteMutation({ operational_revision: 0, status: 'CANCELLED' }, mutation),
    ).toBe(false);
  });
});
