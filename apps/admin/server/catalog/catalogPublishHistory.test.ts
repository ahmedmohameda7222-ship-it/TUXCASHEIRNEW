import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { createSupabaseCatalogStore } from './catalogService';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
const businessId = '44444444-4444-4444-8444-444444444444';

describe('Admin catalog publish history mapping', () => {
  it('accepts recurring availability publish versions emitted by the trusted scheduler', async () => {
    const select = vi.fn(async (table: string, query: URLSearchParams) => {
      if (table === 'catalog_publish_versions' && query.get('select') === 'publish_version') {
        return [{ publish_version: 49 }];
      }
      if (table === 'catalog_publish_versions') {
        return [
          {
            shop_id: shopId,
            publish_version: 49,
            operations_configuration_version: 49,
            source_kind: 'RECURRING_AVAILABILITY',
            draft_id: null,
            published_by_employee_id: null,
            restored_from_publish_version: null,
            published_at: '2026-09-11T18:00:00.000Z',
          },
        ];
      }
      if (
        table === 'scheduled_config_changes' ||
        table === 'catalog_drafts' ||
        table === 'products'
      ) {
        return [];
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const client = {
      select,
      rpc: vi.fn(),
    } as unknown as AdminSupabaseClient;
    const store = createSupabaseCatalogStore(client);

    await expect(store.loadPublishing(shopId, businessId)).resolves.toMatchObject({
      shopId,
      currentPublishVersion: 49,
      versions: [{ publishVersion: 49, sourceKind: 'RECURRING_AVAILABILITY' }],
    });
  });
});
