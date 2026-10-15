import { describe, expect, it } from 'vitest';

import { catalogCopyErrorMessage } from './catalogCopyFeedback';

describe('Catalog Copy actionable server error handling', () => {
  it('explains missing dependencies, conflicts and stale previews', () => {
    const expectations = [
      ['catalog_copy_missing_target_dependencies', 'target master mapping'],
      ['catalog_copy_target_identity_collision', 'conflicting target identities'],
      ['catalog_copy_target_name_conflict', 'target catalog name'],
      ['catalog_copy_incompatible_inventory_units', 'Inventory Master Bindings'],
      ['catalog_copy_shop_inactive', 'inactive or archived'],
      ['catalog_copy_source_unpublished', 'no published catalog'],
      ['stale_catalog_copy_preview', 'Refresh both shops'],
      ['stale_draft_revision', 'Refresh both shops'],
      ['command_id_conflict', 'different inputs'],
    ];

    for (const [code, snippet] of expectations) {
      const message = catalogCopyErrorMessage(new Error(code));
      expect(message).toContain(snippet);
      expect(message).not.toBe(code);
    }
  });

  it('preserves other server codes and has a safe unknown fallback', () => {
    const denied = catalogCopyErrorMessage(new Error('permission_forbidden'));

    expect(denied).toBe('permission_forbidden');
    expect(catalogCopyErrorMessage(null)).toBe('Catalog copy failed.');
  });
});
