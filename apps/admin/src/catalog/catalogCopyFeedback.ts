/** Turn trusted Catalog Copy RPC conflict codes into actionable, non-sensitive guidance. */
export function catalogCopyErrorMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : '';
  switch (code) {
    case 'catalog_copy_missing_target_dependencies':
      return 'Copy blocked: one or more selected source entities lack a target master mapping, mapped modifier or combo option, or compatible recipe inventory binding. Nothing was staged. Resolve the missing dependencies before previewing again.';
    case 'catalog_copy_target_identity_collision':
      return 'Copy blocked: source entities resolve to conflicting target identities. Check the business-master bindings before previewing again.';
    case 'catalog_copy_target_name_conflict':
      return 'Copy blocked: a target catalog name conflicts with the selected source entity. Resolve the target conflict before copying.';
    case 'catalog_copy_incompatible_inventory_units':
      return 'Copy blocked: recipe inventory base units or tracking modes are incompatible. Verify explicit Inventory Master Bindings in both shops.';
    case 'catalog_copy_creation_conflict':
      return 'Creation blocked: at least one selected source entity cannot be assigned a new target-local identity. Review explicit creation decisions and any existing master mapping.';
    case 'catalog_copy_unresolved_entity_dependencies':
      return 'Creation blocked: a selected Product has modifier or combo dependencies that cannot be safely created or remapped. Resolve or map those dependencies first; nothing was staged.';
    case 'catalog_copy_target_draft_invalid':
      return 'Creation blocked: the target draft is unavailable or no longer editable. Reload the target shop.';
    case 'invalid_catalog_copy_selection':
      return 'Creation blocked: selected entities are empty, duplicated or invalid. Review the selected Categories and Products.';
    case 'catalog_copy_shop_inactive':
      return 'Copy blocked: the source or target shop is inactive or archived.';
    case 'catalog_copy_source_unpublished':
      return 'Copy blocked: the source shop has no published catalog.';
    case 'stale_catalog_copy_preview':
    case 'stale_draft_revision':
      return 'The source publication or target draft changed. Refresh both shops and preview again before staging.';
    case 'command_id_conflict':
      return 'The copy command was already used with different inputs. Refresh and create a new preview.';
    default:
      return code || 'Catalog copy failed.';
  }
}
