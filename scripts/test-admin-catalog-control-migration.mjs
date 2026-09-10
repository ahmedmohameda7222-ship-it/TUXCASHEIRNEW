import fs from 'node:fs';

const path = 'supabase/migrations/20260910110000_admin_catalog_control.sql';
const sql = fs.readFileSync(path, 'utf8').toLowerCase();

const requiredObjects = [
  'catalog_master_products',
  'catalog_master_categories',
  'catalog_product_shop_overrides',
  'catalog_drafts',
  'catalog_draft_changes',
  'catalog_publish_versions',
  'scheduled_config_changes',
  'recurring_availability_rules',
  'create_catalog_draft_v1',
  'apply_catalog_draft_change_v1',
  'publish_catalog_draft_v1',
  'set_immediate_product_availability_v1',
];

for (const name of requiredObjects) {
  if (!sql.includes(name)) {
    throw new Error(`admin catalog control migration missing ${name}`);
  }
}

console.log('Admin catalog control migration invariant passed.');
