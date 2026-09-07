# TUX Canonical Catalog Authority & Contracts Design

**Status:** Ready for user review  
**Date:** 2026-09-07  
**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Phase A authority:** `work/monorepo-foundation` at `3b5d107ee24b97fd3adf8eb8793e1fc6f0402fe6`  
**Phase B branch:** `work/catalog-authority-contracts`

## 1. Purpose and chosen migration strategy

Phase B creates one durable catalog authority before standalone Admin extraction and before the public Menu changes backend authority.

The selected architecture is a **contract-first strangler migration with vertical slices**:

```text
legacy Menu/Admin authority
        |
        v
B0 authority audit
        |
        v
B1 canonical contracts
        |
        v
B2 public read vertical slice
        |
        v
B3 deterministic legacy mapping
        |
        v
B4 admin command + authorization boundary
        |
        +----> Phase C: standalone apps/admin
        +----> Phase D: Menu canonical cutover
        +----> Phase E: legacy retirement
```

This is preferred over Admin-first extraction because copying the existing Admin first would copy the legacy data model and direct browser Supabase CRUD, requiring a second rewrite. A big-bang Menu + Admin + schema migration is rejected because it couples too many failure surfaces. A new standalone catalog microservice is also rejected because the existing Supabase Edge Function architecture already provides the required trusted HTTP boundary.

Phase B is additive. It must not remove the current Menu/Admin runtime, apply production migrations, migrate production data, or perform production cutover without separate explicit authorization.

## 2. Starting authority and branch rules

Accepted Phase A checkpoint:

```text
Branch: work/monorepo-foundation
HEAD: 3b5d107ee24b97fd3adf8eb8793e1fc6f0402fe6
TREE: a9c106bd7c9b27921588a45a641d5119ab6abfe7
PARENT: ef9cf4a6030aded70ad27a005ce9c6fb4e7d448b
```

Phase A remains frozen. All Phase B changes belong on:

```text
work/catalog-authority-contracts
```

Protected authorities outside Phase B write scope:

```text
main
work/operations-whatsapp-inbox-live
PR #54
production Supabase
Meta production resources
```

The imported TUX-MENU history and original TUX-MENU repository remain provenance/reference authority until Phase E.

## 3. Current-state findings

### 3.1 Canonical business domain already exists

`packages/domain/src/catalog.ts` already defines the core business concepts:

```text
MenuCategory
Product
Modifier
ProductModifierLink
ComboBeverageOption
RecipeLine
OperationsConfigurationSnapshot
```

Canonical identity is UUID-based and prices use integer minor units. Canonical `Product` already carries shop/category ownership, description, `priceMinor`, `imageKey`, optional merchandising family, active state, sold-out state, combo state, and sort order.

`@tux/domain` remains the business-semantic authority. Phase B may add a genuinely missing business concept after audit, but must not create a second generic Product/Category domain for Menu/Admin convenience.

### 3.2 Canonical persistence already exists

Root `supabase/migrations/` already owns canonical shop-scoped tables including:

```text
shops
shop_memberships
menu_categories
products
modifiers
product_modifiers
combo_beverage_options
inventory_items
recipe_lines
```

Catalog IDs are UUIDs; canonical prices are `BIGINT` minor units; products already include `image_key`, `active`, `sold_out`, `is_combo`, and sort order.

Root `supabase/migrations/` remains the only migration authority. Legacy `supabase_setup.sql` must never become executable authority again.

### 3.3 Existing trusted backend pattern

The repository already uses Supabase Edge Functions for authoritative remote behavior, with explicit per-function JWT policy in `supabase/config.toml`. Existing Operations functions demonstrate token validation, authorization, shop isolation, canonical Supabase access, and HTTP boundaries.

Phase B therefore uses Supabase Edge Functions rather than introducing another backend service or deployment stack.

### 3.4 Current Menu is legacy-coupled

`apps/menu/src/context/MenuContext.tsx` currently reads legacy `product_sections` and `products` directly from browser Supabase and merges them with checked-in fallback data.

Current customer behavior depends on legacy string IDs, category slugs, product/category descriptions, EGP major-unit prices, image URLs, active/availability state, bestseller state, and sort ordering.

### 3.5 Current Admin is a feature reference only

`apps/menu/src/pages/Admin.tsx` currently provides:

- email/password login/logout;
- category create/edit/delete;
- product create/edit/delete;
- category assignment;
- description, price, active state, bestseller state and sort-order editing;
- product image upload/replace/remove;
- loading, confirmation, success and error behavior.

It also performs direct browser CRUD against legacy tables and direct browser storage mutations. Browser session presence is effectively treated as sufficient authorization. That implementation must not be copied as the architecture of future `apps/admin`.

## 4. Binding architecture principles

1. Canonical Supabase schema plus `@tux/domain` are the only catalog business authority.
2. `apps/menu` and future `apps/admin` never import `apps/operations` or `apps/operations-desktop` implementation.
3. Public reads and Admin writes use versioned transport contracts, not persistence row shapes.
4. Public Menu ultimately stops querying catalog tables directly.
5. Admin ultimately stops mutating database/storage directly from the browser.
6. Supabase authentication proves identity; server-side shop membership proves Admin authorization.
7. `OWNER` and `ADMIN` are Admin-authorized roles. `OPERATIONS_DEVICE` is denied.
8. Service-role or equivalent privileged secrets never enter browser bundles.
9. Image ownership is canonical and shop-scoped.
10. Legacy IDs map deterministically to canonical UUIDs; display-name matching is forbidden.
11. Phase B preserves current runtime behavior until later cutovers.
12. No production Supabase mutation occurs without separate explicit production authorization.
13. No Nx/Turbo/new monorepo framework or standalone catalog microservice is introduced.
14. Phase B introduces one narrowly scoped transport package, `@tux/catalog-contracts`, because the existing `@tux/platform-contracts` is a desktop IPC surface coupled to Operations application types and is not an appropriate web/runtime contract authority.

## 5. Target architecture

```text
                       Canonical Supabase
                   supabase/migrations only
                             |
             +---------------+---------------+
             |                               |
      canonical catalog tables        shop_memberships
             |                               |
             +---------------+---------------+
                             |
                    Supabase Edge Functions
                  /                         \
                 /                           \
        catalog-public                  catalog-admin
        public read                     authenticated write
        verify_jwt=false                verify_jwt=true
                 |                           |
                 v                           v
             apps/menu                  future apps/admin
          (cut over Phase D)             (built Phase C)
```

Operations continues to consume canonical configuration through its existing configuration path. Menu/Admin do not depend on the Operations app or desktop IPC surface.

## 6. B0 — Authority audit and field classification

Before adding schema/API behavior, B0 checks all current migrations and classifies every legacy field/behavior as exactly one of:

```text
DIRECT_MAP
SEMANTIC_REMAP
NEW_CANONICAL_FIELD
PRESENTATION_ONLY
DEPRECATED
```

Minimum legacy inventory:

```text
Category:
id, name, slug, description, sort_order, is_active

Product:
id, section_id/category_id, name, description, price,
image_url, image_path, is_best_seller, is_active, sort_order
```

Canonical comparison covers `menu_categories`, `products`, modifiers, links, combos and any later migration already extending them.

Initial gaps requiring explicit B0 resolution include:

- stable category public slug;
- category public description if not already added by a later migration;
- product bestseller/merchandising state if not already canonical;
- stable product public/deep-link key where parity requires it;
- legacy URL/path/bundled-image ownership versus canonical `image_key`.

No field may silently disappear. No duplicate column may be introduced if a later migration already covers the concept.

B0 must also record actual legacy availability behavior before deciding how `is_active` maps to canonical `active` and `sold_out`.

## 7. Canonical identity, public identity and money

Database identity remains UUID-based.

Public routing identity is separate from UUID and mutable display name:

```text
Category:
  id   = canonical UUID
  slug = stable public route identity

Product:
  id       = canonical UUID
  publicKey/slug = stable public/deep-link identity where required
```

Imported legacy slugs/IDs are preserved as public identities where valid. Mapping by product/category display name is prohibited.

Legacy major-unit prices convert explicitly to integer minor units:

```text
190 EGP -> 19000 priceMinor
```

Migration logic rejects non-finite, negative or unsafe values and must not persist floating-point money as canonical authority.

## 8. `@tux/catalog-contracts` ownership

Phase B creates:

```text
packages/catalog-contracts
package name: @tux/catalog-contracts
```

It owns only web-safe catalog transport DTOs, stable error envelopes, command/result contracts and runtime parsing/validation needed by HTTP consumers/tests.

Dependency direction:

```text
@tux/domain
     ^
     |
application/business semantics

@tux/catalog-contracts
     |
     +---- apps/menu
     +---- future apps/admin
     +---- contract/integration tests
```

Rules:

- it must not import Operations app implementation;
- it must not become a generic API mega-package;
- it must not own persistence row types;
- it may represent IDs/money on the wire in JSON-safe primitives while validating them at boundaries;
- domain/application code converts explicitly between wire DTOs and branded domain values;
- existing `@tux/platform-contracts` remains desktop/IPC-facing and is not expanded into the catalog-web authority.

Supabase Edge Functions may use a function-local/shared implementation if bundling a workspace package is operationally awkward, but their outputs/inputs must be validated against the canonical `@tux/catalog-contracts` schemas in tests. There is still one transport contract authority, not two independently designed shapes.

## 9. B1/B2 — Public catalog contract and read vertical slice

The canonical public Edge Function is:

```text
catalog-public
verify_jwt = false
```

Public read is intentionally unauthenticated and strictly read-only. It accepts a validated configured shop UUID and returns a fixed customer-safe projection.

Conceptual v1 response:

```ts
interface PublicCatalogSnapshotV1 {
  schemaVersion: 1;
  shopId: string;
  revision: string;
  categories: PublicCatalogCategoryV1[];
  products: PublicCatalogProductV1[];
  modifiers: PublicCatalogModifierV1[];
  productModifierLinks: PublicProductModifierLinkV1[];
  comboBeverageOptions: PublicComboBeverageOptionV1[];
}
```

Customer-safe category fields include canonical/public identity, name, description, availability/active semantics and sort order. Product fields include canonical/public identity, category relation, name, description, `priceMinor`, resolved public image representation, merchandising flag when canonicalized, active/sold-out/combo state and sort order.

Inventory, recipes, worker data, memberships, payment configuration and other Operations-only data must never be included. The public contract is deliberately not `OperationsConfigurationSnapshot`.

The first executable slice implements category + product projection only. It must prove shop isolation, deterministic ordering, minor-unit prices, active/sold-out transport semantics, stable identities, no internal-field leakage, malformed-shop rejection and backend-error classification. Modifiers and combo options are added only after the base slice is GREEN.

### Public errors

Stable public error codes include at minimum:

```text
400 invalid_shop_id
404 shop_not_found
503 catalog_unavailable
500 catalog_read_failed
```

Internal SQL/Supabase details, environment values and secrets are never returned.

## 10. Catalog revision and caching

Phase B v1 uses a deterministic **SHA-256 content revision**, not a new revision table or event system.

Algorithm:

1. construct the fully sorted customer-safe public projection;
2. serialize it with one canonical field/order rule excluding `revision` itself;
3. compute SHA-256;
4. expose the lowercase hex digest as `revision`.

Therefore the revision changes exactly when customer-visible canonical catalog content changes and is independent of database timestamps or unrelated Operations data.

This is intentionally simple at TUX scale and avoids another mutable authority. If profiling later proves hashing materially expensive, optimization is a separate evidence-driven change.

Caching may use conservative headers/ETag semantics based on the content revision. Cache policy must allow Admin changes to become visible predictably and may not convert backend failure into stale authority silently.

## 11. B3 — Deterministic legacy mapping and dry-run migration

Phase B designs and tests migration but does not apply it to production.

Required properties:

- explicit legacy source ID for every category/product;
- explicit fixed UUID or deterministic committed UUID-generation rule;
- explicit category-reference mapping by legacy ID;
- deterministic price conversion;
- explicit image disposition;
- no display-name matching;
- duplicate/unknown identifiers fail closed;
- every source row has exactly one disposition;
- repeated dry-runs are byte-for-byte/deterministically equivalent in mapping output;
- dry-run performs zero remote writes.

Migration dispositions:

```text
CREATE
MATCH_EXPLICITLY
SKIP_INTENTIONALLY
ERROR
```

A committed manifest/fixture is preferred over hidden one-off state.

### Availability semantics

Canonical intent is:

```text
active  = item participates in active catalog/business configuration
soldOut = temporary sale unavailability while item remains a known catalog item
```

B0 must first prove how legacy inactive items are currently rendered. Mapping must preserve visible behavior; it may not silently hide products that customers currently see as unavailable. Category semantics require their own explicit decision because categories do not currently have a canonical `sold_out` concept.

## 12. Canonical image/storage authority

Legacy ownership currently mixes full URLs, storage paths and bundled source assets. Canonical authority standardizes on:

```text
products.image_key
        |
        v
shop-scoped canonical storage object
        |
        v
public URL resolved at transport/presentation boundary
```

Recommended namespace:

```text
catalog-product-images/<shopId>/<object-id>.<ext>
```

The exact bucket name may be finalized in implementation, but these security/ownership rules are binding:

- object paths are shop-scoped;
- clients never choose arbitrary privileged paths;
- no privileged storage secret enters browser code;
- Admin authorization controls upload/delete eligibility;
- replacement/deletion cannot remove an image still referenced by another product;
- database mutation and cleanup failure are explicit;
- bundled/legacy assets are migration inputs, not canonical runtime authority after cutover.

## 13. B4 — Admin authentication, authorization and commands

Canonical Admin Edge Function:

```text
catalog-admin
verify_jwt = true
```

Every mutation performs:

```text
Supabase JWT
   |
   v
verified auth user
   |
   v
requested shopId
   |
   v
active shop_memberships row
   |
   +-- OWNER -> allow
   +-- ADMIN -> allow
   +-- OPERATIONS_DEVICE -> deny
   +-- no/inactive membership -> deny
```

If service-role access is used internally after authorization, it exists only inside the trusted function runtime and is covered by explicit authorization/security tests.

Browser clients send validated commands, not arbitrary row patches. Feature-parity command surface required to support Phase C includes:

```text
CreateCategory
UpdateCategory
DeleteOrRetireCategory
ReorderCategory
CreateProduct
UpdateProduct
DeleteOrRetireProduct
ReorderProduct
SetProductImage
RemoveProductImage
```

Canonical capabilities can extend the contract with:

```text
SetProductSoldOut
Create/UpdateModifier
Assign/RemoveModifier
ConfigureComboBeverageOptions
```

Phase B implements only the approved B4 slices, but the boundary must support Phase C without another backend rewrite.

Every command validates IDs, shop ownership, cross-shop references, price semantics, string constraints, sort-order constraints, role authorization and retry/idempotency requirements where relevant.

## 14. Admin image upload protocol

The new Admin must not regain unrestricted direct bucket mutation.

Preferred flow:

```text
Admin browser
   |
   | authenticated request
   v
catalog-admin requests/authorizes upload
   |
   v
short-lived signed upload target/token for canonical shop path
   |
   v
browser uploads binary directly to Storage
   |
   v
catalog-admin commits validated image_key
```

This preserves server-controlled ownership while avoiding large binary proxying through the command function. An equivalent Supabase-supported flow may be selected only if it preserves the same authorization and path-isolation properties.

## 15. Delete/retire, atomicity and concurrency

The old Admin hard-deletes records. Canonical TUX has durable business history, so hard delete is not the default authority rule.

Default policy:

```text
referenced by durable history -> retire/deactivate
provably never-used and unreferenced -> delete may be allowed
```

Category deletion may not cascade away product/business history implicitly.

Multi-row operations such as reorder, retirement, modifier assignment or combo configuration must be atomic. Sequential browser CRUD loops are not authoritative mutation logic. If normal Supabase calls cannot guarantee atomicity, a database function/RPC is introduced through root migrations and invoked from the trusted Admin function.

Do not introduce event sourcing or generalized distributed concurrency infrastructure. Add optimistic concurrency only where tests demonstrate a material lost-update risk.

## 16. Coexistence with Operations, Menu and future Admin

### Operations

Operations keeps its existing canonical configuration path. Schema additions must remain compatible with existing Operations queries/snapshots or be adapted explicitly. Internal recipe/inventory data stays out of the public projection. Every Phase B migration runs full migration-chain and Operations regression tests.

### Menu during Phase B

Runtime remains:

```text
MenuContext -> legacy tables/fallbacks
```

The canonical read boundary is built and verified in parallel. Runtime cutover is Phase D only.

### Standalone Admin

Phase B does not create `apps/admin` UI. Phase C will rebuild the old Admin feature set against `catalog-admin`, using old `Admin.tsx` as behavioral reference rather than copying its architecture. Direct browser legacy CRUD disappears only when standalone Admin is accepted.

## 17. Testing and CI strategy

New behavior follows TDD with preserved RED -> GREEN evidence.

### Architecture guards

Prove at minimum:

- Menu/Admin never import Operations app implementation;
- `@tux/catalog-contracts` does not import app or persistence implementation;
- public/Admin wire contracts do not expose persistence row types;
- root `supabase/migrations/` remains sole migration authority;
- legacy executable SQL does not return;
- browser source cannot reference privileged service-role secrets;
- new direct catalog CRUD is not introduced into browser code outside explicitly grandfathered transitional legacy files.

### Public contract tests

Cover invalid shop ID, missing shop, ordering, minor-unit prices, public identities, active/sold-out state, modifier/combo shape, non-disclosure of internal fields, deterministic revision and backend error classification.

### Admin security/command tests

Cover missing/invalid JWT, missing/inactive membership, `OPERATIONS_DEVICE` denial, `ADMIN`/`OWNER` allowance, cross-shop rejection, invalid IDs/prices, atomic behavior, storage path scoping and image authorization.

### Mapping tests

Cover complete source-row dispositions, deterministic UUID/public identity mapping, price conversion, category reference resolution, duplicate/unknown failure, zero-write dry-run and repeatability.

### Regression gates

Every accepted Phase B checkpoint retains root clean install, format/lint, unit/integration tests, typecheck, production builds, migration-chain tests, Operations E2E, Menu E2E, monorepo architecture guards and existing permanent Windows packaging/required gates.

Permanent CI must verify the exact implementation-branch HEAD intended for Phase B acceptance; catalog gates are additive and may not weaken existing Operations/Menu gates.

## 18. Phase B implementation slices and acceptance

### B0 — Authority Audit

Outputs:

- field/behavior matrix;
- complete current migration/schema inventory;
- explicit gap list;
- initial migration source inventory.

Gate: no legacy field/behavior remains unclassified.

### B1 — Canonical Contracts

Outputs:

- `@tux/catalog-contracts`;
- versioned public wire contract and runtime validation;
- Admin command/result skeleton;
- architecture guards.

Gate: contract/architecture tests show RED before implementation and GREEN after it, with no runtime cutover.

### B2 — Public Read Vertical Slice

Outputs:

- `catalog-public` Edge Function;
- explicit `verify_jwt=false` configuration;
- category/product projection first;
- deterministic SHA-256 revision;
- modifiers/combo projection only after base slice is GREEN;
- contract/security/error tests.

Gate: exact customer-safe projection, shop isolation, deterministic ordering/revision and no internal leakage.

### B3 — Legacy Mapping / Migration Design

Outputs:

- deterministic mapping manifest/fixture;
- dry-run migration tool;
- parity/disposition report;
- zero-write verification.

Gate: every source row is deterministically accounted for and repeated dry-runs agree.

### B4 — Admin Command + Authorization Boundary

Outputs:

- `catalog-admin` Edge Function;
- explicit `verify_jwt=true` configuration;
- user + active membership authorization;
- command validation and atomic mutation primitives;
- signed/server-authorized image workflow primitives;
- security tests.

Gate: unauthorized actors cannot mutate; `OWNER`/`ADMIN` can execute validated shop-scoped commands; no privileged secret reaches browser code.

### Phase B final gate

Phase B is accepted only when:

1. B0-B4 are GREEN;
2. exact-head permanent CI is GREEN;
3. Operations regression is GREEN;
4. current Menu runtime remains legacy-authoritative until Phase D;
5. no standalone Admin UI has been prematurely extracted;
6. no production Supabase schema/data/storage mutation has occurred;
7. Phase C can build Admin against the B4 boundary without redesigning the backend.

## 19. Explicit non-goals

Phase B does not:

- redesign the Menu UI;
- build standalone `apps/admin` UI;
- remove `/admin` from Menu;
- cut Menu runtime to the canonical backend;
- apply production migrations or migrate production data;
- retire TUX-MENU;
- modify unrelated WhatsApp work;
- add a standalone catalog microservice;
- add a new monorepo framework;
- build a generic CMS;
- add event sourcing;
- add speculative tenant-discovery infrastructure.

## 20. Production safety

Repository implementation is not production authorization. Phase B may commit migrations, Edge Function source, auth config, contract packages, dry-run tooling, fixtures, tests and documentation.

Without a later explicit production instruction, Phase B must not:

```text
apply remote migrations
write canonical production catalog data
mutate production storage
switch Menu production authority
remove the legacy production backend
archive/delete TUX-MENU
modify Meta production resources
```

## 21. Continuation after Phase B

Mandatory remaining program:

```text
Phase C — Standalone apps/admin extraction
Phase D — apps/menu canonical backend cutover
Phase E — legacy TUX-MENU retirement after production verification
```

Final topology includes:

```text
apps/
  operations/
  operations-desktop/
  menu/
  admin/

packages/
  application/
  catalog-contracts/
  config/
  domain/
  persistence/
  platform-contracts/
  printing/
  sync/
  ui/

api/
server/
supabase/migrations/
```

All customer/Admin/Operations surfaces converge on one canonical catalog business truth without app-to-app implementation coupling.

## 22. Final binding decision

Phase B architecture is:

```text
canonical Supabase + @tux/domain
              |
              +--> @tux/catalog-contracts (wire authority)
              |
              v
       Supabase Edge Functions
        /                  \
 catalog-public          catalog-admin
 public, read-only       JWT + OWNER/ADMIN membership
        |                  |
        v                  v
 apps/menu later         apps/admin later

legacy runtime remains operational during Phase B
legacy identities map deterministically
public revision = SHA-256 of canonical customer-safe projection
production cutover remains separately authorized
```

This design optimizes for one durable business truth, minimal duplicate work, incremental verification, explicit security boundaries and low migration risk.