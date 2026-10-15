import { describe, expect, it } from 'vitest';

import { catalogCopyErrorMessage } from './catalogCopyFeedback';

describe('Catalog Copy actionable server error handling', () => {
  it.each([
    ['catalog_copy_missing_target_dependencies', 'target master mapping'],
    ['catalog_copy_target_identity_collision', 'conflicting target identities'],
    ['catalog_copy_target_name_conflict', 'target catalog name'],
    ['catalog_copy_incompatible_inventory_units', 'Inventory Master Bindings'],
    ['catalog_copy_shop_inactive', 'inactive or archived'],
    ['catalog_copy_source_unpublished', 'no published catalog'],
    ['stale_catalog_copy_preview', 'Refresh both shops'],
    ['stale_draft_revision', 'Refresh both shops'],
    ['command_id_conflict', 'different inputs'],
  ])('renders a scoped explanation for %s', (code,expectedText) => {
    const message = catalogCopyErrorMessage(new Error(code));
    expect(message).toContain(expectedText);
    expect(message).not.toBe(code);
  });

  it('preserves other known server response codes and has a safe unknown fallback', () => {
    expect(catalogCopyErrorMessage(new Error('permission_forbidden'))).toBe('permission_forbidden');
    expect(catalogCopyErrorMessage(null)).toBe('Catalog copy failed.');
  });
});
