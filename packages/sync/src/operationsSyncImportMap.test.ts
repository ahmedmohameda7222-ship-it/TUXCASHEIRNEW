import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { shouldApplyRemoteMutation, type RemoteTableMutation } from './remoteMaterializer';

const reviewedSha = 'f26b4eb040050226412668d84461dd4697d1069b';
const rawBase = 'https://raw.githubusercontent.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/';

describe('operations-sync deployment dependency provenance', () => {
  it('pins the deployed materializer and domain to the reviewed CAS-capable baseline', () => {
    const mapUrl = new URL(
      '../../../supabase/functions/operations-sync/deno.json',
      import.meta.url,
    );
    const rawJson = readFileSync(mapUrl, 'utf8');
    const imports = (JSON.parse(rawJson) as { imports: Record<string, string> }).imports;

    expect(imports['@tux/remote-materializer']).toBe(
      `${rawBase}${reviewedSha}/packages/sync/src/remoteMaterializer.ts`,
    );
    expect(imports['@tux/domain']).toBe(`${rawBase}${reviewedSha}/packages/domain/src/index.ts`);

    // Raw GitHub serves TypeScript sources, not the compiled .js imports emitted by the
    // workspace barrel. Map each .js specifier back to its immutable .ts source.
    const domainPrefix = `${rawBase}${reviewedSha}/packages/domain/src/`;
    const domainSourceAliases = Object.entries(imports).filter(
      ([specifier, target]) =>
        specifier.startsWith(domainPrefix) &&
        !specifier.endsWith('.js') &&
        target.startsWith(domainPrefix) &&
        target.endsWith('.ts'),
    );
    expect(domainSourceAliases.length).toBeGreaterThan(20);
    for (const [specifier, target] of domainSourceAliases) {
      expect(imports[`${specifier}.js`]).toBe(target);
    }

    const domainIndex = readFileSync(new URL('../../domain/src/index.ts', import.meta.url), 'utf8');
    const exportedModules = [...domainIndex.matchAll(/from '\\.\\/([A-Za-z]+)\\.js'/g)];
    for (const match of exportedModules) {
      const moduleName = match[1];
      expect(imports[`${domainPrefix}${moduleName}.js`]).toBe(`${domainPrefix}${moduleName}.ts`);
    }

    for (const [specifier, target] of Object.entries(imports)) {
      if (specifier.startsWith(rawBase)) {
        expect(specifier).toContain(`/${reviewedSha}/`);
      }
      if (target.startsWith(rawBase)) {
        expect(target).toContain(`/${reviewedSha}/`);
      }
    }
  });

  it('requires the previous status and revision for order lifecycle changes', () => {
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

    const valid = { operational_revision: 0, status: 'ACTIVE' };
    const replayed = { operational_revision: 1, status: 'DONE' };
    const wrongStatus = { operational_revision: 0, status: 'CANCELLED' };

    expect(shouldApplyRemoteMutation(valid, mutation)).toBe(true);
    expect(shouldApplyRemoteMutation(replayed, mutation)).toBe(false);
    expect(shouldApplyRemoteMutation(wrongStatus, mutation)).toBe(false);
  });
});
