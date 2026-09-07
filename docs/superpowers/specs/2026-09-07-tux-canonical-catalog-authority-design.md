# TUX Canonical Catalog Authority & Contracts Design

**Status:** Written architectural design for user review  
**Date:** 2026-09-07  
**Canonical repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Phase A frozen checkpoint:** `work/monorepo-foundation` at `3b5d107ee24b97fd3adf8eb8793e1fc6f0402fe6`  
**Phase B working branch:** `work/catalog-authority-contracts`

## 1. Purpose

Phase B establishes one canonical catalog authority for TUX before the public Menu is cut over and before the standalone Admin application is extracted.

The objective is not to build a generic catalog platform or introduce a new service tier. The objective is to create the minimum durable authority and contracts required so that Operations, the public Menu, and the future Admin can share one product/category/modifier truth without app-to-app coupling or direct browser ownership of database mutations.

The migration strategy is a contract-first strangler migration:

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
        |
        +----> Phase D: Menu canonical cutover
        |
        +----> Phase E: legacy retirement
```

Phase B must leave the current Menu and legacy `/admin` behavior operational until their later cutover/extraction phases. It must not perform production Supabase writes or production cutover without separate explicit authorization.

## 2. Authoritative starting state

The accepted Phase A product checkpoint is:

```text
Repository: ahmedmohameda7222-ship-it/TUXCASHEIRNEW
Branch: work/monorepo-foundation
HEAD: 3b5d107ee24b97fd3adf8eb8793e1fc6f0402fe6
TREE: a9c106bd7c9b27921588a45a641d5119ab6abfe7
PARENT: ef9cf4a6030aded70ad27a005ce9c6fb4e7d448b
```

Phase A is frozen. Phase B work belongs on an isolated child branch:

```text
work/catalog-authority-contracts
```

The following authorities remain protected and outside Phase B write scope unless explicitly reopened:

```text
main
work/operations-whatsapp-inbox-live
PR #54
production Supabase resources
Meta production resources
```

The independent TUX-MENU repository remains provenance/reference material until the later retirement phase.

## 3. Why this is the chosen architecture

Three approaches were considered.

### 3.1 Admin-first extraction — rejected

Copying the existing Admin into `apps/admin` before canonical authority exists would copy the legacy data model and direct browser Supabase CRUD into a new application. The Admin would then need a second rewrite after canonical catalog migration.

### 3.2 Big-bang Menu + Admin + database migration — rejected

Changing schema, authorization, storage, Admin UI, public Menu reads, data migration, and deployment in one release would create a large failure surface and weak fault isolation.

### 3.3 Contract-first strangler migration — selected

The repository already contains a canonical shop-scoped catalog domain and schema. The missing part is the explicit read/write transport boundary and deterministic mapping from the imported legacy Menu model. Building those boundaries in vertical slices reuses existing authority, avoids duplicated UI work, and keeps every cutover independently testable and reversible.

## 4. Inspected current-state findings

### 4.1 Canonical domain already exists

`packages/domain/src/catalog.ts` already defines canonical business concepts including:

```text
MenuCategory
Product
Modifier
ProductModifierLink
ComboBeverageOption
RecipeLine
OperationsConfigurationSnapshot
```

Canonical IDs are branded UUID-backed identifiers and prices use integer minor units through `MoneyMinor`.

The canonical `Product` includes:

```text
id
shopId
categoryId
name
description
priceMinor
imageKey
family?
active
soldOut
isCombo
sortOrder
```

This domain remains the business-semantic authority. Phase B must extend it only where an audited business concept is genuinely missing; it must not create a second generic Product model for Menu/Admin convenience.

### 4.2 Canonical Supabase schema already exists

The root migration authority already includes shop-scoped canonical tables such as:

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

Catalog IDs are UUIDs, prices are `BIGINT` minor units, and products already have `image_key`, `active`, `sold_out`, `is_combo`, and sort order.

All new schema work must be expressed only through root `supabase/migrations/`. No legacy SQL may become executable authority.

### 4.3 Existing remote-backend pattern

The repository already uses Supabase Edge Functions for authoritative remote behavior and makes every function's platform JWT policy explicit in `supabase/config.toml`.

Existing Operations flows demonstrate:

- explicit JWT verification configuration;
- server-side token validation;
- shop/device authorization checks;
- canonical Supabase access behind an HTTP function boundary;
- separate browser/server gateway concerns.

Phase B should follow this architecture rather than create a new microservice, framework, or deployment tier.

### 4.4 Current public Menu remains legacy-coupled

`apps/menu/src/context/MenuContext.tsx` currently:

- directly creates browser Supabase queries;
- reads legacy `product_sections` and `products`;
- merges database rows with checked-in fallback categories/products;
- exposes legacy-shaped `ProductSection` and `SupabaseProduct` types;
- treats fallback data as runtime authority when Supabase is unavailable or incomplete.

The current public route and rendering behavior depend on stable string category/product identifiers, category slugs, descriptions, prices in EGP major units, image URLs, availability flags, bestseller flags, and sort order.

### 4.5 Current Admin remains legacy-coupled

`apps/menu/src/pages/Admin.tsx` currently provides useful behavior that must become the feature-parity baseline for Phase C:

- Supabase email/password sign-in and sign-out;
- category create/edit/delete;
- product create/edit/delete;
- category assignment;
- description, price, active state, bestseller state, and sort order editing;
- product image upload, replacement, and removal;
- loading, confirmation, success, and error states.

However, it performs direct browser CRUD against legacy tables and direct browser storage mutations. A valid Supabase session is effectively treated as sufficient authorization.

That implementation is a behavioral reference only. It is not the architecture to copy into `apps/admin`.

## 5. Binding Phase B principles

1. Canonical Supabase schema plus `packages/domain` are the only catalog business authority.
2. `apps/menu` and future `apps/admin` never depend on `apps/operations` or `apps/operations-desktop` implementation.
3. Public reads and Admin mutations use explicit HTTP contracts, never raw database-row contracts.
4. Public Menu code must ultimately stop querying catalog tables directly.
5. Admin must ultimately stop mutating database tables/storage directly from the browser.
6. Supabase user authentication is identity proof, not authorization. Admin authorization is an explicit active shop-membership check.
7. Admin-authorized roles are `OWNER` and `ADMIN`. `OPERATIONS_DEVICE` is not an Admin role.
8. Privileged/service-role secrets never ship to browser bundles.
9. Image ownership is canonical and shop-scoped.
10. Legacy string identifiers are mapped deterministically to canonical UUID records. Matching by display name is prohibited.
11. Phase B is additive and cutover-safe. Current Menu/Admin behavior is not removed yet.
12. No remote migration or production data write occurs without explicit production authorization.
13. No new monorepo framework or standalone catalog microservice is introduced.
14. New packages are introduced only if an implementation-boundary audit proves the existing packages cannot represent the contract cleanly.

## 6. Target authority and data flow

The target architecture is:

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
                    /                       \
                   /                         \
       public catalog read             admin catalog commands
       unauthenticated read             authenticated + authorized
                 |                               |
                 v                               v
             apps/menu                    future apps/admin
                 |
                 v
              customer
```

Operations continues to consume canonical configuration through its existing device/configuration path. Phase B must not make Menu/Admin depend on the Operations app or desktop IPC surface.

## 7. B0 — Catalog authority audit

B0 produces a checked-in, testable field-and-behavior inventory before schema/API implementation.

The audit must cover at minimum:

### 7.1 Legacy category fields

```text
id
name
slug
description
sort_order
is_active
```

### 7.2 Legacy product fields

```text
id
section_id/category_id
name
description
price
image_url
image_path
is_best_seller
is_active
sort_order
```

### 7.3 Canonical equivalents

```text
menu_categories.id
menu_categories.shop_id
menu_categories.name
menu_categories.sort_order
menu_categories.active

products.id
products.shop_id
products.category_id
products.name
products.description
products.price_minor
products.image_key
products.active
products.sold_out
products.is_combo
products.sort_order
```

### 7.4 Required audit decisions

Every legacy behavior must be classified as exactly one of:

```text
DIRECT_MAP
SEMANTIC_REMAP
NEW_CANONICAL_FIELD
PRESENTATION_ONLY
DEPRECATED
```

No field may silently disappear during migration.

The initial expected gaps are:

- category public slug;
- category public description if current schema lacks it;
- product bestseller/merchandising state if current schema lacks it;
- stable public identity needed to preserve legacy deep-link behavior;
- canonical image object-key ownership versus legacy full URL/path ownership.

The audit may discover later migrations already cover any of these. If so, duplicate columns must not be added.

## 8. Canonical identity and route compatibility

Canonical database identity remains UUID-based.

Public routing identity must not depend on UUIDs or mutable display names. Phase B therefore defines a stable public slug/key where current canonical schema does not already provide one.

Required semantics:

```text
Category:
  id        = canonical UUID identity
  slug      = stable public route identity

Product:
  id        = canonical UUID identity
  slug/key  = stable public/deep-link identity when required for parity
```

For imported legacy records, the public slug/key must preserve the existing stable legacy route/deep-link identifier wherever valid.

Examples:

```text
legacy category id/slug: tux-burger
canonical category id:   <UUID>
canonical category slug: tux-burger

legacy product id:       single-tux-burger
canonical product id:    <UUID>
canonical product slug:  single-tux-burger
```

Display-name matching is forbidden because names are mutable and not unique migration identity.

## 9. Price semantics

Canonical catalog prices are integer minor units.

For EGP:

```text
legacy price 190 EGP
        -> canonical priceMinor 19000
```

Migration code must use an explicit currency/minor-unit conversion function and reject non-finite or unsafe values. No floating-point arithmetic may become canonical persisted money authority.

The public transport contract returns integer `priceMinor`; presentation clients format it for EGP.

## 10. Public catalog read contract

Phase B introduces a versioned public read boundary implemented as a Supabase Edge Function. The proposed function name is:

```text
catalog-public
```

Its platform configuration is explicit:

```text
verify_jwt = false
```

This is deliberate: customer Menu reads are public. The function itself is strictly read-only and returns a fixed projection from canonical catalog tables.

The endpoint accepts a validated shop identifier. Phase B does not introduce a multi-tenant discovery service; the Menu deployment may supply its configured shop UUID.

Conceptual v1 response:

```ts
interface PublicCatalogSnapshotV1 {
  readonly schemaVersion: 1;
  readonly shopId: string;
  readonly revision: string;
  readonly categories: readonly PublicCatalogCategoryV1[];
  readonly products: readonly PublicCatalogProductV1[];
  readonly modifiers: readonly PublicCatalogModifierV1[];
  readonly productModifierLinks: readonly PublicProductModifierLinkV1[];
  readonly comboBeverageOptions: readonly PublicComboBeverageOptionV1[];
}
```

Category projection includes only customer-safe fields:

```text
id
slug
name
description
active
sortOrder
```

Product projection includes only customer-safe fields:

```text
id
slug/public key
categoryId
name
description
priceMinor
image
bestSeller/merchandising flag when canonicalized
active
soldOut
isCombo
sortOrder
```

Modifier/combo projections expose only information required to render/order the public menu. Inventory, recipes, costs, worker data, payment configuration, memberships, and other Operations-only data are never included.

The read contract is intentionally separate from `OperationsConfigurationSnapshot`; public Menu must not consume a device/internal configuration bundle that contains unrelated operational data.

## 11. Public catalog revision and caching

The response carries an opaque `revision` suitable for cache invalidation and diagnostics. Phase B must not introduce a complex event system solely for this.

Implementation should prefer the smallest deterministic revision mechanism that survives concurrent reads, for example a content hash or a canonical per-shop catalog revision if an existing revision mechanism already fits.

The public function may emit conservative CDN/browser cache headers, but cache behavior must not make Admin changes appear permanently stale. Exact cache policy belongs to the implementation plan after the schema/revision audit.

## 12. Public catalog errors

The public boundary uses stable machine-readable error codes. At minimum:

```text
400 invalid_shop_id
404 shop_not_found
503 catalog_unavailable
500 catalog_read_failed
```

Internal Supabase errors, SQL details, environment values, or secrets must not be returned to clients.

Transient backend failure must remain distinguishable from a legitimate empty catalog.

## 13. B1 — Contract ownership

Business semantics remain in `@tux/domain`.

Transport semantics must not be pushed into the domain merely because Menu/Admin need JSON types.

The implementation-plan audit must choose between:

1. extending the existing `@tux/platform-contracts` package with a web-catalog subpath if it can remain coherent; or
2. introducing a narrowly scoped catalog transport package only if the current desktop-oriented declaration package cannot safely own runtime/web transport contracts.

The default is to avoid a new package. However, Phase A inspection shows `@tux/platform-contracts` is currently a desktop IPC declaration surface that imports Operations application services. If implementation requires runtime schema validation shared by Menu/Admin, a focused new contract package is justified rather than coupling public web contracts to desktop application services.

This decision must be settled by a RED architecture test before package creation, not by preference.

## 14. B2 — Public read vertical slice

The first executable Phase B slice is deliberately narrow:

```text
canonical category + product tables
        |
        v
catalog-public function
        |
        v
contract parser/test
```

The first GREEN slice proves:

- valid shop isolation;
- category ordering;
- product ordering;
- integer minor-unit prices;
- active/sold-out semantics are transported without reinterpretation;
- stable canonical UUIDs plus stable public slugs/keys;
- no internal-only columns leak;
- malformed shop IDs are rejected;
- backend failure is not treated as an empty catalog.

Modifiers and combo options are added only after the category/product slice is GREEN.

`apps/menu` is not cut over in Phase B. It may gain test fixtures or a future client contract, but runtime authority remains unchanged until Phase D.

## 15. B3 — Deterministic legacy mapping and migration design

Phase B defines and tests the legacy-to-canonical migration but does not apply it to production without explicit authorization.

The mapping must be reproducible and auditable.

Required properties:

- legacy source identifier is recorded explicitly;
- canonical UUID is fixed explicitly or generated deterministically from a committed rule;
- no display-name matching;
- category references are mapped by explicit legacy ID;
- price conversion is deterministic;
- image source ownership is classified;
- every source row produces exactly one migration disposition;
- rerunning a dry-run produces the same mapping;
- unknown/duplicate source identifiers fail closed.

A committed migration manifest/fixture is preferred over an opaque one-off script state.

The migration report must classify each source row as:

```text
CREATE
MATCH_EXPLICITLY
SKIP_INTENTIONALLY
ERROR
```

No silent drop is allowed.

## 16. Availability semantics

Phase B must not casually equate all legacy `is_active` behavior with canonical `active` and `sold_out`.

The audit must document the observed current behavior first.

Canonical intent is:

```text
active = catalog record participates in active business configuration
soldOut = temporarily unavailable for sale while remaining a known catalog item
```

If the current Menu intentionally displays an inactive legacy item as "currently not available", the migration must preserve that visible behavior either through a documented semantic remap or through the public contract. It must not silently hide items that were previously visible.

Category availability has no existing canonical `sold_out` field, so category behavior requires an explicit audit decision rather than guessing.

## 17. Canonical image/storage ownership

Legacy ownership currently mixes:

```text
image_url
image_path
product-images bucket
bundled /src assets
```

Canonical product authority already has `image_key`. Phase B standardizes on object-key ownership rather than storing generated public URLs as business data.

Target semantics:

```text
products.image_key
        |
        v
canonical catalog image bucket/path
        |
        v
public URL resolved at transport/presentation boundary
```

Recommended canonical storage namespace:

```text
catalog-product-images/<shopId>/<object-id>.<ext>
```

The exact bucket name is an implementation detail, but the following rules are binding:

- paths are shop-scoped;
- filename/path generation does not trust client-supplied paths;
- browser bundles never contain privileged storage credentials;
- public customer reads can resolve catalog images efficiently;
- Admin write authorization controls upload/delete authority;
- database mutation and image cleanup have explicit failure handling;
- deleting/replacing a product image must not accidentally remove an object referenced by another product;
- legacy bundled assets are migration inputs, not canonical runtime storage authority after cutover.

## 18. Admin authentication and authorization boundary

The future Admin may continue to use Supabase Auth for email/password identity, but a browser session alone is never sufficient mutation authorization.

Phase B introduces an authenticated Admin catalog Edge Function. Proposed function name:

```text
catalog-admin
```

Its platform policy is explicit:

```text
verify_jwt = true
```

Every mutation request follows:

```text
Supabase JWT
    |
    v
auth.getUser / verified identity
    |
    v
requested shopId
    |
    v
active shop_memberships row
    |
    +-- role OWNER -> allowed
    +-- role ADMIN -> allowed
    +-- role OPERATIONS_DEVICE -> denied
    +-- no active membership -> denied
```

Authorization is performed server-side before privileged mutation access.

If a service-role client is used internally after authorization, it exists only inside the trusted Edge Function runtime. Its use must be narrow and covered by authorization tests because service-role access bypasses normal RLS behavior.

## 19. Admin command contract

The Admin transport surface is command-oriented even if the HTTP routing is REST-like. Browser code must not send arbitrary database row patches.

Initial command set required for old-Admin feature parity:

```text
CreateCategory
UpdateCategory
DeleteCategory or RetireCategory
CreateProduct
UpdateProduct
DeleteProduct or RetireProduct
SetProductImage
RemoveProductImage
ReorderCategory
ReorderProduct
```

The canonical model also supports later commands for:

```text
SetProductSoldOut
CreateModifier
UpdateModifier
AssignModifierToProduct
RemoveModifierFromProduct
ConfigureComboBeverageOptions
```

Phase B only implements commands required by its approved vertical slices. Phase C uses the complete required parity surface when the Admin UI is extracted.

Each command validates:

- canonical UUIDs;
- shop ownership of every referenced entity;
- strings/lengths;
- non-negative integer minor-unit prices;
- sort-order constraints;
- cross-shop references;
- role authorization;
- concurrency/idempotency requirements where mutation retries can occur.

## 20. Admin image upload protocol

The new Admin must not regain direct unrestricted bucket write authority.

Preferred flow:

```text
Admin browser
   |
   | authenticated request
   v
catalog-admin: request upload ticket
   |
   | membership authorization
   v
short-lived signed upload target / token
   |
   v
browser uploads image directly to Storage
   |
   v
catalog-admin command commits canonical image_key
```

This keeps large binary transfer off the mutation function while retaining server-authorized path ownership.

If Supabase Storage capabilities at implementation time make a different server-authorized upload flow materially simpler, the implementation plan may choose it only if it preserves the same security properties.

## 21. Delete versus retire semantics

The legacy Admin currently hard-deletes categories/products. Canonical TUX has order history with foreign keys and snapshots, so unconditional hard delete is not a safe long-term default.

Phase B must define catalog retirement rules before exposing delete commands.

Default design:

```text
records referenced by durable business history -> retire/deactivate, do not hard-delete
never-used records eligible for delete only if referential checks prove safety
```

The public/Admin UI may still label an action "Delete" where appropriate, but the server-side command decides whether the legal business operation is delete or retire.

Category deletion must not cascade away product/business history without an explicit separately approved rule.

## 22. Transactionality and concurrency

Multi-row commands such as reorder, category retirement, modifier assignment, or combo configuration must be atomic at the canonical database boundary.

Do not implement sequential browser CRUD loops as authority.

Where the Supabase client API cannot guarantee the required atomicity, use a database function/RPC introduced through `supabase/migrations/` and called by the trusted Admin function.

Phase B should use optimistic concurrency only where lost updates are realistic and materially harmful. It must not introduce a generic event-sourcing system.

## 23. Operations coexistence

Operations already consumes a canonical configuration path. Phase B must preserve it.

Requirements:

- no Menu/Admin app dependency on Operations implementation;
- no regression to Operations configuration synchronization;
- canonical catalog changes remain compatible with `OperationsConfigurationSnapshot` or are adapted explicitly;
- internal-only Operations fields such as recipes remain outside the public catalog projection;
- any schema addition used by Menu/Admin must be migration-compatible with existing Operations queries/tests.

Every Phase B migration must run the full migration-chain and Operations regression suite.

## 24. Public Menu coexistence before Phase D

During Phase B the current Menu runtime remains unchanged by default:

```text
MenuContext -> legacy Supabase tables/fallbacks
```

The new canonical public read boundary exists in parallel and is verified independently.

Phase D later changes runtime authority to:

```text
apps/menu
   |
   v
catalog HTTP client
   |
   v
catalog-public
   |
   v
canonical Supabase
```

The old direct queries/fallback merge are removed only after rendered behavior and data cutover are accepted.

## 25. Standalone Admin relationship to Phase C

Phase B does not build `apps/admin` UI.

It creates the secure authority needed so Phase C can build it once.

Phase C requirements inherited from this design:

- start with complete feature-parity inventory from legacy Admin;
- rebuild the UI against canonical Admin commands;
- use old `Admin.tsx` as behavioral reference, not architecture template;
- preserve category/product/image management behavior;
- add canonical sold-out/modifier/combo controls only according to Phase C scope;
- remove direct legacy browser Supabase CRUD;
- remove legacy `/admin` implementation from `apps/menu` only when standalone Admin is accepted.

## 26. Contract/version compatibility

Public and Admin transport contracts are explicitly versioned at the schema level.

Breaking changes require a new contract version or a coordinated migration proving all consumers move together.

Database schema version and HTTP contract version are separate concepts. Clients depend on the HTTP contract, not table shapes.

## 27. Testing strategy

Phase B is test-driven where functionality is added.

### 27.1 Architecture tests

Add guards proving:

- Menu/Admin do not import Operations app implementation;
- public/admin catalog contracts do not expose persistence row types;
- only root `supabase/migrations/` owns schema migrations;
- legacy SQL never returns as executable authority;
- browser source cannot reference service-role secrets;
- legacy direct catalog CRUD is not introduced outside explicitly grandfathered Phase B transitional files.

### 27.2 Contract tests

Public catalog tests cover:

- invalid shop ID;
- shop not found;
- category/product ordering;
- price minor units;
- stable public slugs/keys;
- active/sold-out flags;
- modifier/combo shape;
- internal-field non-disclosure;
- backend error classification.

Admin tests cover:

- missing JWT;
- invalid JWT;
- inactive/no membership;
- `OPERATIONS_DEVICE` denied;
- `ADMIN` allowed;
- `OWNER` allowed;
- cross-shop reference rejected;
- invalid prices/IDs rejected;
- atomic mutation behavior;
- image authorization/path scoping.

### 27.3 Migration mapping tests

Tests prove:

- every legacy category/product has one disposition;
- deterministic UUID/public-key mapping;
- price conversion;
- category references resolve;
- duplicates fail;
- unknown references fail;
- dry-run has zero remote writes;
- repeated dry-runs produce identical output.

### 27.4 Regression tests

Every accepted Phase B checkpoint retains:

- root clean install;
- formatting/lint;
- unit/integration tests;
- typecheck;
- production builds;
- migration chain;
- Operations rendered E2E;
- Menu rendered E2E;
- Windows packaging where required by permanent CI;
- monorepo architecture gate.

## 28. CI and exact-head verification

Phase B continues the Phase A exact-head evidence standard.

Permanent CI must test the exact implementation-branch commit intended for acceptance. No completion claim may rely only on a synthetic PR merge commit if literal branch-head evidence is available/required.

Phase B adds catalog-specific tests into permanent CI without weakening any existing Operations/Menu gate.

## 29. Deployment and production safety

Repository implementation is not production migration authorization.

Phase B may add:

- migrations;
- Edge Function source;
- function auth config;
- fixtures;
- dry-run migration tooling;
- tests;
- documentation.

It must not, without a later explicit production action:

- apply migrations to production Supabase;
- upload canonical production catalog data;
- mutate production storage;
- change Menu production authority;
- remove the legacy production backend;
- archive/delete TUX-MENU;
- change Meta production resources.

## 30. Branching and parallel work

Phase A remains frozen at its accepted commit.

Phase B uses:

```text
work/catalog-authority-contracts
```

created from the accepted Phase A head.

Unrelated WhatsApp corrections remain on their own Operations lane. Phase B must not fold deferred WhatsApp fixes into catalog commits.

Final integration ordering is a separate merge/closeout decision; Phase B implementation does not authorize merging the stacked program into `main`.

## 31. Phase B implementation slices and acceptance gates

Phase B implementation is decomposed into separately verifiable slices.

### B0 — Authority Audit

Outputs:

- field/behavior matrix;
- current canonical-schema inventory;
- explicit gap list;
- initial migration fixture inventory.

Gate: no ambiguous legacy field remains unclassified.

### B1 — Canonical Contract

Outputs:

- versioned public catalog wire contract;
- Admin command contract skeleton;
- architecture guard for transport/domain ownership.

Gate: contract tests RED then GREEN without app runtime cutover.

### B2 — Public Read Vertical Slice

Outputs:

- `catalog-public` Edge Function;
- category/product canonical projection;
- explicit platform auth config;
- Deno/Node contract tests;
- modifier/combo extension after base slice passes.

Gate: exact canonical projection, shop isolation, no internal leakage.

### B3 — Legacy Mapping / Migration Design

Outputs:

- deterministic mapping manifest/fixture;
- dry-run migration tool;
- parity report;
- zero-write verification by default.

Gate: all source rows have deterministic dispositions and dry-run is reproducible.

### B4 — Admin Command + Authorization Boundary

Outputs:

- `catalog-admin` Edge Function;
- JWT and membership authorization;
- parity command set required for Phase C foundation;
- server-authorized image workflow primitives;
- security tests.

Gate: unauthorized roles cannot mutate; authorized roles can execute validated shop-scoped commands; no privileged secret reaches browser code.

### Phase B final gate

Phase B is complete only when:

1. B0-B4 gates are GREEN;
2. exact-head permanent CI is GREEN;
3. Operations runtime behavior is unchanged unless explicitly required by compatible canonical schema additions;
4. Menu runtime remains legacy-authoritative until Phase D;
5. no `apps/admin` UI extraction has been prematurely performed;
6. no production Supabase data/schema/storage mutation has occurred;
7. the next Phase C design can consume the Admin boundary without another backend rewrite.

## 32. Explicit non-goals

Phase B does not:

- redesign the public Menu UI;
- extract standalone `apps/admin` UI;
- remove `/admin` from Menu;
- cut Menu production reads to canonical authority;
- apply production migrations;
- migrate production catalog data;
- retire TUX-MENU;
- fix unrelated WhatsApp work;
- add a catalog microservice;
- add Nx/Turbo/etc.;
- build generic CMS functionality;
- introduce event sourcing;
- add speculative multi-tenant discovery infrastructure.

## 33. Required final program continuation

After accepted Phase B:

```text
Phase C — Standalone Admin Extraction
Phase D — Menu Canonical Backend Cutover
Phase E — Legacy TUX-MENU Retirement
```

The final mandatory topology remains:

```text
apps/
  operations/
  operations-desktop/
  menu/
  admin/

packages/
  ...shared semantic/application contracts...

api/
server/
supabase/migrations/
```

All three product surfaces converge on one canonical catalog truth.

## 34. Decision summary

The binding architecture for Phase B is:

```text
canonical Supabase schema + @tux/domain
                 |
                 v
     explicit catalog HTTP boundaries
          /                 \
         /                   \
public read Edge Function   admin command Edge Function
         |                   |
         |                   +-- Supabase JWT identity
         |                   +-- active OWNER/ADMIN membership
         |                   +-- server-authorized storage
         v
future Menu cutover

legacy Menu/Admin remains live during Phase B
legacy IDs map deterministically to UUIDs + stable public slugs
production cutover remains separately authorized
```

This design intentionally optimizes for one durable business truth, incremental verification, minimal duplicate implementation, and low migration risk rather than short-term copy/move speed.
