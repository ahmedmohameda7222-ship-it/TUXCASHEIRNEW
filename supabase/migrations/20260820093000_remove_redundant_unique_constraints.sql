-- Remove redundant unique constraints that duplicate the canonical primary keys introduced by
-- 20260820023000_operations_sync_domain_parity.sql. The primary keys continue to enforce the
-- same uniqueness guarantees without duplicate indexes/write amplification.

alter table public.order_item_combo_beverages
  drop constraint order_item_combo_beverages_order_item_id_unit_index_key;

alter table public.reconciliation_lines
  drop constraint reconciliation_lines_reconciliation_id_payment_method_id_key;
