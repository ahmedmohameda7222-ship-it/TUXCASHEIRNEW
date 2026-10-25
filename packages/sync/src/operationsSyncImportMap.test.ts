import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { shouldApplyRemoteMutation, type RemoteTableMutation } from './remoteMaterializer';

const reviewedDomainSha = 'f26b4eb040050226412668d84461dd4697d1069b';
const reviewedMaterializerSha = 'cccefb47726a11b61aafae0092cd4d1b0f374a67';
const rawBase = 'https://raw.githubusercontent.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/';

describe('operations-sync deployment dependency provenance', () => {
  it.each(['operations-order-lifecycle', 'operations-order-rewards', 'operations-session-exit'])(
    'keeps %s independently deployable with an explicit Supabase import map',
    (functionName) => {
      const mapUrl = new URL(
        `../../../supabase/functions/${functionName}/deno.json`,
        import.meta.url,
      );
      const imports = (
        JSON.parse(readFileSync(mapUrl, 'utf8')) as {
          imports: Record<string, string>;
        }
      ).imports;

      expect(imports['@supabase/supabase-js']).toMatch(/^jsr:@supabase\/supabase-js@2/);
    },
  );

  it('pins the deployed materializer and domain to the reviewed CAS-capable baseline', () => {
    const mapUrl = new URL(
      '../../../supabase/functions/operations-sync/deno.json',
      import.meta.url,
    );
    const rawJson = readFileSync(mapUrl, 'utf8');
    const imports = (JSON.parse(rawJson) as { imports: Record<string, string> }).imports;

    expect(imports['@tux/remote-materializer']).toBe(
      `${rawBase}${reviewedMaterializerSha}/packages/sync/src/remoteMaterializer.ts`,
    );
    expect(imports['@tux/domain']).toBe(
      `${rawBase}${reviewedDomainSha}/packages/domain/src/index.ts`,
    );

    // Raw GitHub serves TypeScript sources, not the compiled .js imports emitted by the
    // workspace barrel. Map each .js specifier back to its immutable .ts source.
    const domainPrefix = `${rawBase}${reviewedDomainSha}/packages/domain/src/`;
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
    const exportedModules = [...domainIndex.matchAll(/from '\.\/([A-Za-z]+)\.js'/g)];
    for (const match of exportedModules) {
      const moduleName = match[1];
      expect(imports[`${domainPrefix}${moduleName}.js`]).toBe(`${domainPrefix}${moduleName}.ts`);
    }

    for (const [specifier, target] of Object.entries(imports)) {
      if (specifier.startsWith(rawBase)) {
        expect([reviewedDomainSha, reviewedMaterializerSha]).toContain(
          specifier.slice(rawBase.length).split('/')[0],
        );
      }
      if (target.startsWith(rawBase)) {
        expect([reviewedDomainSha, reviewedMaterializerSha]).toContain(
          target.slice(rawBase.length).split('/')[0],
        );
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
