# Legacy TUX-MENU Database Reference

`supabase_setup.sql.reference` is historical reference material imported from TUX-MENU. It is not a migration or executable database authority for TUXCASHEIRNEW.

Do not run it against the canonical TUX Supabase project and do not copy it into `supabase/migrations/`.

The historical model uses `product_sections`, text identifiers, `price NUMERIC`, and legacy `product-images` assumptions. Canonical TUX is shop-scoped and uses `menu_categories`, UUID identifiers, `price_minor BIGINT`, modifiers, combo options, inventory/configuration contracts, and root `supabase/migrations/`.

Catalog reconciliation belongs to Phase B.
