# TUX Phase B — Canonical Catalog Authority Audit

Status: Phase B B0 authority audit
Date: 2026-09-07
Authority reviewed: `packages/domain` + root `supabase/migrations/`
Legacy reference: imported Menu runtime and `apps/menu/legacy/supabase_setup.sql.reference` (reference only; never executable migration authority)

## Classification vocabulary

Every legacy field/behavior in this audit is classified with one of the approved values only: `DIRECT_MAP`, `SEMANTIC_REMAP`, `NEW_CANONICAL_FIELD`, `PRESENTATION_ONLY`, `DEPRECATED`.

## Current canonical evidence

The canonical foundation already owns `shops`, `shop_memberships`, `menu_categories`, `products`, `modifiers`, `product_modifiers`, `combo_beverage_options`, recipes, inventory, orders and order snapshots. Existing catalog columns already include product `description`, integer `price_minor`, `image_key`, `active`, `sold_out`, `is_combo`, and `sort_order`.

The foundation does **not** currently contain category public slug, category description, product public slug/key, or product bestseller/merchandising state. Those are the only catalog field gaps identified by this audit.

`order_items.product_id`, `order_item_modifiers.modifier_id`, and `order_item_combo_beverages.beverage_product_id` retain references to canonical catalog records. Phase B therefore adopts a retire/deactivate policy as the default delete semantic; it does not blindly hard-delete historically referenced catalog rows.

## Legacy category field audit

| Legacy field | Classification | Canonical destination / decision |
| --- | --- | --- |
| `id` | `SEMANTIC_REMAP` | Explicit legacy identifier -> `menu_categories.id` UUID; never match by display name. |
| `name` | `DIRECT_MAP` | `menu_categories.name`. |
| `slug` | `NEW_CANONICAL_FIELD` | Add `menu_categories.slug`; stable public route identity, unique per shop. |
| `description` | `NEW_CANONICAL_FIELD` | Add nullable `menu_categories.description`. |
| `sort_order` | `DIRECT_MAP` | `menu_categories.sort_order`. |
| `is_active` | `DIRECT_MAP` | `menu_categories.active`. |

## Legacy product field audit

| Legacy field | Classification | Canonical destination / decision |
| --- | --- | --- |
| `id` | `SEMANTIC_REMAP` | Explicit legacy identifier -> `products.id` UUID; preserve stable public identity separately. |
| `section_id` / `category_id` | `SEMANTIC_REMAP` | Resolve only through explicit category mapping to canonical `products.category_id`; unknown references fail closed. |
| `name` | `DIRECT_MAP` | `products.name`. |
| `description` | `DIRECT_MAP` | Existing `products.description`. |
| `price` | `SEMANTIC_REMAP` | Deterministically convert EGP major units to integer `products.price_minor` (x100); malformed/non-finite/unsafe values fail closed. |
| `image_url` | `PRESENTATION_ONLY` | A public URL is not canonical DB truth; public URLs are derived from canonical storage ownership. |
| `image_path` | `SEMANTIC_REMAP` | If source storage is canonical-owned, normalize to shop-scoped `products.image_key`; otherwise record an explicit image migration disposition. |
| `is_best_seller` | `NEW_CANONICAL_FIELD` | Add `products.best_seller boolean`; canonical merchandising state. |
| `is_active` | `DIRECT_MAP` | `products.active`. |
| `sort_order` | `DIRECT_MAP` | `products.sort_order`. |

## Canonical schema decisions

### Category public identity
`menu_categories.id` remains UUID authority. Add `menu_categories.slug` as stable customer route identity with shop-scoped uniqueness. Display names are never migration or route identity.

### Category description
Add `menu_categories.description text`; it is customer-safe catalog content, not presentation formatting.

### Product public identity
`products.id` remains UUID authority. Add `products.slug` as stable public/deep-link identity with shop-scoped uniqueness. Legacy product identifiers/slugs are preserved by the explicit mapping manifest.

### Bestseller / merchandising
Add `products.best_seller boolean not null default false`. This is canonical merchandising state and is not inferred from order or display name.

### Existing fields reused
No duplicate columns are introduced for product description, money, image ownership, sold-out state, combo state, activation, or ordering. Existing `products.description`, `price_minor`, `image_key`, `sold_out`, `is_combo`, `active`, and `sort_order` remain authoritative.

### Additive compatibility
The Phase B migration is additive. Slug fields are initially nullable so existing Operations rows remain valid before any separately authorized data migration. Public/admin boundaries require valid stable slugs for customer-visible/new records; missing required public identity is treated as unavailable catalog data, never synthesized from a mutable name.

## Legacy Admin feature-parity baseline

This is a Phase C parity baseline only. Phase B implements server-side contracts/boundaries, not a new Admin UI.

| Legacy behavior | Classification | Decision |
| --- | --- | --- |
| sign in / sign out | `SEMANTIC_REMAP` | Supabase Auth owns session identity; `catalog-admin` validates user JWT and DB membership server-side. |
| category create | `DIRECT_MAP` | `category.create`. |
| category edit | `DIRECT_MAP` | `category.update`. |
| category delete | `SEMANTIC_REMAP` | `category.retire`; preserve history/references. |
| product create | `DIRECT_MAP` | `product.create`. |
| product edit | `DIRECT_MAP` | `product.update`. |
| product delete | `SEMANTIC_REMAP` | `product.retire`; preserve historical order references. |
| category assignment | `DIRECT_MAP` | Product category UUID mutation after same-shop validation. |
| description | `DIRECT_MAP` | Canonical description fields. |
| price | `SEMANTIC_REMAP` | Admin transport uses canonical integer `priceMinor`; legacy decimal conversion is migration-only. |
| active | `DIRECT_MAP` | Canonical `active`. |
| bestseller | `NEW_CANONICAL_FIELD` | Canonical `products.best_seller`. |
| sort order | `DIRECT_MAP` | Canonical `sort_order`; public ordering has deterministic UUID tie-break. |
| image upload | `SEMANTIC_REMAP` | Server-authorized, shop-scoped key flow; browser never owns arbitrary privileged paths. |
| image replace | `SEMANTIC_REMAP` | Validate both old/new key ownership, update DB, then deterministic best-effort cleanup. |
| image delete | `SEMANTIC_REMAP` | Validate shop ownership, clear DB key, then delete only the previously-owned object. |
| loading behavior | `PRESENTATION_ONLY` | Phase C UI concern. |
| error behavior | `SEMANTIC_REMAP` | Stable machine-readable transport errors replace raw Supabase errors. |
| success behavior | `PRESENTATION_ONLY` | Phase C UI feedback concern. |
| confirmation behavior | `PRESENTATION_ONLY` | Phase C UI concern. |

## Deprecated authority / behavior

| Legacy authority / behavior | Classification | Decision |
| --- | --- | --- |
| Executing `apps/menu/legacy/supabase_setup.sql.reference` | `DEPRECATED` | Reference only. Root `supabase/migrations/` is the sole executable migration authority. |
| Matching legacy rows by mutable display name | `DEPRECATED` | Explicit identifier -> UUID manifest is required. |
| Persisting arbitrary public image URLs as canonical ownership | `DEPRECATED` | Canonical DB owns `image_key`; URLs are derived presentation data. |
| New direct privileged browser catalog/storage CRUD | `DEPRECATED` | Future canonical mutations go through `catalog-admin`; existing legacy runtime remains untouched until its authorized cutover phase. |

## Phase boundaries preserved

- No production migration/data mutation is performed by B0.
- No Menu runtime cutover occurs in Phase B.
- Legacy `/admin` remains available.
- Original TUX-MENU history remains untouched.
- Operations/WhatsApp behavior is not redesigned.
