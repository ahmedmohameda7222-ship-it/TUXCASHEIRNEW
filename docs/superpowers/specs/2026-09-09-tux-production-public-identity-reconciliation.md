# TUX Production Public Identity Reconciliation

## Status

Approved on 2026-09-09.

## Goal

Make the current canonical Supabase catalog readable by the customer-facing Menu by assigning stable public slugs to the existing canonical category and product UUIDs without changing the approved production catalog business data.

## Authorities

- **Canonical products, prices, names, descriptions, categories, availability, sold-out state, family, combo flags, sort order, and UUIDs:** Supabase project `awpdcsayuwbsruwvaosg`, shop `c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46`.
- **Customer-facing visual/UX and route compatibility reference only:** `ahmedmohameda7222-ship-it/TUX-MENU` pinned at commit `285635181a9ee1ec2f760feb38abae8fa19a201d`.
- The old `TUX-MENU` repository is **not** an authority for current product rows or prices.

## Production Inventory Fence

The approved inventory for this migration is exactly:

- 7 categories.
- 49 products.
- All 56 rows belong to shop `c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46`.
- The migration must fail before writes if the category-ID set or product-ID set differs from the committed manifest.
- Existing non-null slugs are allowed only when they already equal the committed slug for that UUID; conflicting slugs fail closed.

## Public Category Identities

| Canonical UUID | Canonical name | Public slug |
| --- | --- | --- |
| `dac1ac74-aa52-5804-966c-cef65d196fd4` | Burgers | `burgers` |
| `89346cad-bf3a-5682-a426-292d6e2017e4` | Combo | `combos` |
| `677f5b6a-1be0-5345-8afa-cfd8e0eec7e4` | Fries | `fries` |
| `05a318bf-cefa-5149-aae6-fd5d94138943` | Hawawshi | `hawawshi` |
| `a0263027-0afa-52bf-9f34-e27ec77136b8` | Zalabia | `zalabia` |
| `c55b48e4-4dec-5cfc-a179-ab93a911542b` | Extras | `extras` |
| `26ecbec9-0883-5acf-a413-4ccdce760bd8` | Drinks | `drinks` |

`Burgers` remains one canonical category. Existing Menu routing resolves `/tux-burger` to `burgers + family=TUX` and `/tuxify` to `burgers + family=TUXIFY`; no duplicate category is created.

## Public Product Identities

The mapping is explicit and UUID-keyed. Runtime code must never derive or match identity by display name.

### Burgers

| UUID | Public slug |
| --- | --- |
| `91a8852a-1481-5a9c-a507-0b4f43ce8142` | `single-tux-burger` |
| `105132ac-a954-5eb6-88cd-48638f660b37` | `double-tux-burger` |
| `e3ab3789-689f-597c-8e91-da968509d97e` | `triple-tux-burger` |
| `d577eb43-16f7-595a-ac06-9d3c86a8f7e8` | `tux-quatro` |
| `55405c76-658a-5122-b8c4-e1d43dc3a201` | `johnnys` |
| `cd450b18-1e33-53ad-8c03-aa60ac6a4b2b` | `single-tuxify` |
| `352b11c1-16be-5ef3-99fc-f7f4e597d75d` | `double-tuxify` |
| `09c91a57-67d5-5f9b-9770-fdd90b2739a9` | `triple-tuxify` |
| `c768950a-607f-56e4-8736-d20ff191b807` | `quatro-tuxify` |

### Combos

| UUID | Public slug |
| --- | --- |
| `67318a26-759b-5f8e-be0a-2ab3e75b0714` | `single-double` |
| `fd4800d7-e195-5e64-aa0a-02a5163ea057` | `double-double` |
| `91a48376-82fa-5369-9f78-988aff038b62` | `twowawshi` |
| `96f7b140-2b20-54bd-96f4-f7e7eecc8a95` | `quadtower` |
| `042312ad-c335-52b4-ad55-3d34dce27dcc` | `quad-4` |

### Fries

| UUID | Public slug |
| --- | --- |
| `e9f5e8f1-b4a2-54db-b3ca-b9b2609f0299` | `classic-fries` |
| `3eb059e6-fc37-5307-9958-ae2f96fe87a1` | `cheese-fries` |
| `6dd049b4-adb6-575d-a14d-fab6e2fb9a33` | `chili-fries` |
| `6f7f8eb9-bdfa-586e-8858-9fc414900186` | `tux-fries` |
| `02a78302-1db6-5a6b-a1f8-29143d4f95e6` | `doppy-fries` |
| `e1a78050-eb0d-5ea7-bd3e-6a659e3a5421` | `extra-tux-fries` |
| `fdb4cc09-a960-5ed1-8374-3e37a0e01857` | `extra-doppy-fries` |
| `a9ec16ef-1b5f-52fa-8062-c21742ede016` | `extra-wedges` |

### Hawawshi

| UUID | Public slug |
| --- | --- |
| `19964d60-21a0-5fb3-8e2d-c4ff1b104367` | `classic-hawawshi` |
| `91cc63aa-d5f5-5c96-a2c6-3fb31d27d6a8` | `tux-hawawshi` |

### Zalabia

| UUID | Public slug |
| --- | --- |
| `08736363-f9e7-5f95-9060-2622e725452e` | `zalabia-sugar-honey-small` |
| `e2962ee4-cc06-59a5-95f0-999da6dcbdcc` | `zalabia-sugar-honey-large` |
| `96d23d74-dc5d-5783-8795-1752608b8710` | `zalabia-chocolate-small` |
| `b3770ece-f855-5575-b913-22d8a1ba788c` | `zalabia-chocolate-large` |
| `6c5ae9a0-b2b0-5f29-a39c-59f4bb44bb28` | `zalabia-pistachio-small` |
| `ec90971b-8ed5-58c1-a1f5-69cda223c22a` | `zalabia-pistachio-large` |
| `ff3f4f4b-44f8-5b32-b2da-23f9b2dc0ad6` | `zalabia-lotus-small` |
| `5f13ba23-50f0-5f15-801d-b52163c7a1fa` | `zalabia-lotus-large` |
| `97551ad6-03ea-56b8-96d5-b2be291e758f` | `zalabia-lotus-chocolate-mix` |
| `fb3bdb64-efdb-51a4-9ac4-fdd327295615` | `zalabia-lotus-pistachio-chocolate-mix-large` |

### Extras

| UUID | Public slug |
| --- | --- |
| `71712668-776b-5abc-a067-23581a97b46a` | `extra-smashed-patty` |
| `ea9e484b-b601-5906-94b6-0bb1b45891b9` | `extra-bacon` |
| `6141f564-c0cb-584c-bcdd-e1fead46f71c` | `extra-cheese` |
| `bc692aea-e690-53e5-844b-acf727c40d0f` | `extra-ranch` |
| `2d0ee6eb-9503-525f-80fd-557049be6d74` | `extra-mushroom` |
| `a0f45823-99c2-5271-995b-79aac2599365` | `extra-caramelized-onion` |
| `87ce3859-f50c-514a-96cb-510c729a1b46` | `extra-jalapeno` |
| `152586f0-728a-54cc-a451-e5e993be14f6` | `extra-tux-sauce` |
| `af02f2b2-dd38-5ee7-bffd-f35fa3dec1ba` | `extra-bun` |
| `78a0c8e5-8ef5-5c3e-8c40-8c4934880680` | `extra-pickle` |
| `2b492ea7-7faf-55be-829f-7a75393344d5` | `extra-mozarella` |
| `23639a0a-3cf6-5dc3-8964-5d5817663b7d` | `extra-tux-hawawshi-sauce` |
| `82192675-56a7-5dbe-a955-d33983ef87ea` | `extra-sauce-selection` |

### Drinks

| UUID | Public slug |
| --- | --- |
| `d9c72a5a-c9b5-52c7-99d5-43a0c62b5bad` | `vcola` |
| `1d272aee-3b94-5e0a-898a-007a60121f60` | `water` |

## Migration Rules

1. Commit a machine-readable manifest containing exactly the UUID/slug bindings above.
2. Validate UUID syntax, slug syntax, unique category slugs, unique product slugs, exact 7/49 count parity, exact category-ID coverage, exact product-ID coverage, and valid product category references.
3. The SQL migration must hard-fence the target shop and exact ID sets before updates.
4. The migration updates only `menu_categories.slug` and `products.slug`.
5. The migration must reject any existing conflicting non-null slug.
6. The migration must verify all 56 slugs after the update.
7. No display-name lookup, fuzzy match, transliteration at runtime, or legacy deterministic UUID creation is permitted.

## Explicit Non-Goals

This phase does **not**:

- change names, descriptions, prices, categories, sort order, `family`, `active`, `sold_out`, `is_combo`, `best_seller`, or image keys;
- create or remove products/categories;
- populate modifiers, product-modifier links, or combo-beverage options;
- import old TUX-MENU product prices or old product rows;
- build TUX Admin;
- change Operations or WhatsApp behavior.

The current Supabase authority has zero modifiers/product-modifier links/combo-beverage options. Those relationships require a separately approved business-authority phase. The Menu may therefore continue to treat current combo rows as unavailable and expose no add-on choices until that later phase.

## Acceptance

- Repository tests prove the manifest is explicit, complete, unique, and UUID-keyed.
- Migration-chain smoke passes.
- PR exact-head CI is green.
- Codex review is clean.
- After merge and merged-main CI, apply the exact merged migration to production.
- Production verification shows 7 category slugs and 49 product slugs populated with no change to the protected business fields.
- `catalog-public` returns a valid catalog rather than `catalog_unavailable` due to missing slugs.
- Menu route acceptance includes `/`, `/order-now`, `/tux-burger`, `/tuxify`, `/hawawshi`, `/fries`, `/combos`, and `/drinks`.
