# TUX Canonical Monorepo Foundation Design

**Status:** Approved architecture captured for written-spec review  
**Date:** 2026-09-06  
**Canonical repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Isolated architecture branch:** `work/monorepo-foundation`  
**Authoritative parent branch:** `work/operations-whatsapp-inbox-live`  
**Source repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

## 1. Purpose

TUXCASHEIRNEW becomes the single long-term source repository for the TUX product platform. The objective is not merely repository consolidation. The program must converge Operations POS, the Electron desktop shell, the public Menu, the private Admin application, shared contracts, server/API code, and Supabase migrations on explicit ownership boundaries and one canonical business truth.

This specification defines **Phase A — Monorepo Foundation** in implementation-ready architectural terms and defines the mandatory boundaries of the later TUX Monorepo Program phases. Phase A is intentionally behavior-preserving and structural. It must not silently perform catalog migration, Admin redesign, dependency modernization, production Supabase changes, Meta changes, or unrelated WhatsApp corrections.

## 2. Authoritative inspected state

At design-writing time the authoritative target source checkpoint is:

```text
Repository: ahmedmohameda7222-ship-it/TUXCASHEIRNEW
Branch: work/operations-whatsapp-inbox-live
HEAD: 11e3e9a1c64b2725e956647d081891e59ffb75a8
TREE: 530d8860e30c28505dad8091e573b1766e559665
PARENT: 198efbf58d995e5ae90340a63d9d585605e24fd4
```

The independent Menu source checkpoint is:

```text
Repository: ahmedmohameda7222-ship-it/TUX-MENU
Branch: main
HEAD: 285635181a9ee1ec2f760feb38abae8fa19a201d
TREE: e9ddcc696470d7bb116e1d888a77ade84f95bf83
PARENT: 793e415e7446e3ab1bfcebd8596f897e66a37277
```

Before any Phase A implementation action, both refs must be fetched again. A legitimate advance of either authoritative ref must be inspected and explicitly reconciled with this design before using a different import/base SHA. No legitimate newer work may be reset or discarded.

The existing `work/operations-whatsapp-inbox-live` branch, `main`, and PR #54 are outside the monorepo branch's write scope. All Phase A documentation, planning, import, integration, and verification commits belong on the isolated child branch `work/monorepo-foundation`, created from the latest legitimate WhatsApp live HEAD.

## 3. Architectural classification and core principles

This is an architectural migration because it changes repository topology, application boundaries, deployment topology, dependency ownership, data authority, and CI composition.

The binding principles are:

1. `TUXCASHEIRNEW` is the canonical repository.
2. npm workspaces remain the monorepo mechanism; no Nx, Turborepo, pnpm, Yarn, Bazel, or equivalent framework is introduced without evidence that npm workspaces are insufficient.
3. Existing TUXCASHEIRNEW history is never rewritten.
4. TUX-MENU history is preserved by rewriting only a disposable source clone into the `apps/menu` prefix.
5. Migration precedes modernization. Dependency upgrades are not mixed into the structural import.
6. Behavior is characterized before structural changes and re-proven after them.
7. Applications remain independently deployable.
8. Apps depend on shared contracts/application boundaries, never on another app's implementation.
9. `supabase/migrations/` is the only canonical migration authority.
10. The legacy TUX-MENU schema is reference material only and must never silently become a second catalog authority.
11. Admin extraction is deferred from Phase A because the current Admin is coupled to the legacy Menu data model, but standalone `apps/admin` is mandatory for TUX Monorepo Program completion.
12. Every phase must have a reviewable, testable, reversible boundary.

## 4. Current repository and runtime findings

### 4.1 TUXCASHEIRNEW

The target repository already uses npm workspaces:

```json
{
  "workspaces": ["apps/*", "packages/*"]
}
```

Existing apps are:

```text
apps/
  operations/
  operations-desktop/
```

Existing shared packages are:

```text
packages/
  application/
  config/
  domain/
  persistence/
  platform-contracts/
  printing/
  sync/
  ui/
```

The root package already executes workspace-wide build/typecheck behavior and root lint/format globs include `apps/**/*`. The root lockfile is npm lockfile v3. The current Operations application uses React 19.2.x while the independent Menu currently uses React 19.1.x; this difference is not a reason to upgrade either during Phase A.

The current root CI includes locked install, formatting, lint, unit/integration tests, WhatsApp architecture/security gates, typecheck, production builds, migration-chain checks, rendered Operations E2E, edge security, and Windows packaging. These gates are authoritative and must not be weakened to accommodate Menu.

The current root Vercel configuration is Operations-specific: it builds `@tux/operations`, serves `apps/operations/dist`, and owns `/api` plus the WhatsApp media-retention cron. It must not be repurposed as a single combined Operations/Menu deployment.

### 4.2 TUX-MENU

TUX-MENU is a React + TypeScript + Vite static frontend. It currently contains both public customer routes and `/admin` in the same browser application. Its application router includes `/`, `/order-now`, named category routes, `/products/:slug`, and `/admin`.

Its Vite configuration uses app-relative aliases:

```text
@       -> <app>/src
@assets -> <app>/src/assets
```

and builds to local `dist/`. Because these paths resolve from the Vite config directory, moving the complete source tree under `apps/menu` should not inherently break alias resolution. This must still be proven by build and rendered route tests.

The current Menu Vercel configuration uses a catch-all SPA rewrite to `/index.html`. Direct/deep-route behavior is therefore a deployment contract and must be preserved in the monorepo deployment.

Menu runtime code reads browser variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

although legacy documentation says no environment variables are required. Phase A must make environment ownership truthful without changing production credentials or backend authority.

### 4.3 Current Admin coupling

The existing `Admin.tsx` imports the Menu application's Supabase client and MenuContext-owned legacy types. It uses browser-side Supabase Auth plus direct CRUD against legacy `product_sections` and `products`, and performs direct object-storage operations against the legacy `product-images` bucket.

Authorization is effectively based on the existence of an authenticated Supabase session, while the legacy SQL grants broad authenticated-role CRUD. This is not the desired long-term TUX Admin security boundary.

Therefore Phase A must not create `apps/admin` by copying this implementation, duplicating the legacy data model, or inventing a generic shared legacy Product abstraction.

### 4.4 Canonical-versus-legacy catalog mismatch

Legacy TUX-MENU models include concepts such as:

```text
product_sections
products.id TEXT
products.section_id TEXT
products.price NUMERIC
website_settings
product-images
```

Canonical TUX already owns a richer shop-scoped model including:

```text
shops
menu_categories.id UUID
products.id UUID
products.shop_id UUID
products.category_id UUID
products.price_minor BIGINT
modifiers
product_modifiers
combo_beverage_options
inventory/configuration structures
```

`packages/domain` already owns canonical catalog contracts including `MenuCategory`, `Product`, `Modifier`, `ProductModifierLink`, `ComboBeverageOption`, and `OperationsConfigurationSnapshot`.

The schemas are not safely interchangeable. Phase A must not create adapters that pretend they are the same business model. Canonical catalog convergence belongs to Phase B.

## 5. Final program topology versus Phase A topology

### 5.1 Mandatory final TUX Monorepo Program state

The final program topology is:

```text
apps/
  operations/
  operations-desktop/
  menu/
  admin/

packages/
  application/
  config/
  domain/
  persistence/
  platform-contracts/
  printing/
  sync/
  ui/

api/
server/

supabase/
  migrations/
```

This is mandatory program state, not an optional roadmap idea.

### 5.2 Allowed transitional Phase A state

Phase A may end with:

```text
apps/
  operations/
  operations-desktop/
  menu/                  # public Menu plus temporary legacy /admin route
```

The temporary `/admin` route exists only to preserve behavior while catalog/API authority is designed and migrated. Its presence is explicitly technical debt with a defined removal phase. **Phase A completion does not equal TUX Monorepo Program completion.**

## 6. Staged TUX Monorepo Program

The program is decomposed into five separately reviewed architectural phases. They must not be collapsed into one implementation plan.

### PHASE A — Monorepo Foundation

Purpose: establish one source repository and reproducible workspace/CI/deployment foundations without changing catalog authority.

Required outcomes:

- history-preserving import of TUX-MENU into `apps/menu`;
- `@tux/menu` as a normal npm workspace;
- one canonical root `package-lock.json` at current HEAD;
- deterministic clean root install;
- legacy SQL quarantined as non-authoritative reference material;
- Menu typecheck/build/rendered route verification;
- root CI integration and monorepo architecture guards;
- independent Menu deployment configuration from the same repository;
- complete Operations non-regression evidence;
- no production Supabase or Meta changes;
- no canonical catalog migration;
- no standalone Admin extraction yet.

### PHASE B — Canonical Catalog/API Architecture

Purpose: create one product/category/modifier business truth and explicit server/data boundaries.

Required outcomes include:

- canonical public catalog read boundary;
- canonical Admin command/mutation boundary;
- canonical shop/user authorization semantics;
- canonical image/storage ownership;
- explicit mapping from legacy Menu identifiers/data to canonical UUID/shop-scoped records;
- canonical contracts in existing domain/application/platform packages where semantically appropriate;
- no app-to-app implementation dependency;
- one Supabase migration authority.

Phase B receives its own architectural design, spec, implementation plan, tests, and approval sequence.

### PHASE C — Standalone Admin Extraction

Purpose: establish the private Admin as its own deployable application on canonical authority.

Required outcomes include:

- `apps/admin` exists as an independent workspace/application;
- server-side authorization is authoritative;
- direct legacy browser Supabase CRUD is removed from Admin;
- no service-role or equivalent privileged secret is shipped to the browser;
- Admin uses canonical catalog/application/API contracts;
- the legacy `/admin` implementation is removed from `apps/menu`;
- public Menu bundles contain no Admin implementation unless a separately approved exception exists.

Phase C is mandatory. It is deferred, not optional.

### PHASE D — Menu Canonical Backend Cutover

Purpose: move the public Menu from the legacy TUX-MENU catalog backend to canonical TUX catalog authority.

Required outcomes include:

- public Menu reads through the approved canonical catalog boundary;
- public Menu no longer depends on legacy `product_sections`/legacy `products` semantics;
- fallback/cutover behavior is explicitly designed and tested;
- public routes and presentation behavior remain verified;
- the legacy TUX-MENU backend is no longer authoritative after accepted production cutover.

### PHASE E — Old TUX-MENU Repository Retirement

Purpose: retire the independent repository only when the canonical monorepo is proven as source and deployment authority.

Retirement is allowed only after:

1. the imported history/provenance is permanently accepted;
2. relevant program phases are merged into canonical `main`;
3. production Menu deploys from `TUXCASHEIRNEW/apps/menu`;
4. production Menu route/deep-link/asset verification passes;
5. production Admin, once required by program stage, deploys from `TUXCASHEIRNEW/apps/admin` and passes its security acceptance;
6. no CI, deployment, operational runbook, or active development process depends on the independent TUX-MENU repository;
7. rollback/provenance records are retained;
8. the user explicitly approves retirement.

The old repository must remain intact/readable until those conditions are met.

## 7. Phase A Git and history migration design

### 7.1 Branch/workspace isolation

`work/monorepo-foundation` is an isolated child of the latest legitimate `work/operations-whatsapp-inbox-live` HEAD. The parent branch remains a source checkpoint and receives no monorepo commits. `main` and PR #54 are not modified by Phase A unless separately authorized later.

### 7.2 History-preserving source rewrite

The approved strategy is a disposable clone of TUX-MENU followed by a path-prefix rewrite:

```text
git filter-repo --to-subdirectory-filter apps/menu
```

or a behaviorally equivalent history-preserving fallback if `git filter-repo` is unavailable.

Requirements:

- the source clone is disposable and separate from TUXCASHEIRNEW;
- the source clone contains the full history reachable from the approved TUX-MENU `main` source, not a shallow history;
- original source HEAD/tree are verified before rewriting;
- rewriting occurs only in the disposable source clone;
- existing TUXCASHEIRNEW commit IDs/history are never rewritten;
- the rewritten history is merged intentionally into `work/monorepo-foundation` with unrelated histories handled explicitly;
- the source history is not squash-imported;
- plain copy/paste is prohibited.

If `git filter-repo` is unavailable, the fallback preference is a non-squashed history-preserving Git subtree-style import. A squash-only or source-copy fallback requires new explicit user approval.

### 7.3 Provenance record

Phase A must create a tracked import provenance record containing at least:

```text
source repository
source branch
original source HEAD
original source tree
rewritten import tip SHA
import merge SHA
canonical base HEAD/tree
history-rewrite method/tool version
```

The import must also prove the imported snapshot corresponds to the approved source snapshot. Preferred evidence is a blob-level/tree comparison after stripping the `apps/menu/` prefix, supplemented by the filter-repo commit map where available. The proof must distinguish expected post-import integration changes from the pristine imported snapshot.

Historical commits may legitimately contain the source repository's nested lockfile and `supabase_setup.sql`; permanent guards apply to the **current canonical HEAD/worktree**, not to immutable imported history.

## 8. Phase A workspace and lockfile design

### 8.1 Workspace identity

After the pristine import, the Menu package becomes:

```text
@tux/menu
```

under `apps/menu`. The existing root workspace globs already include `apps/*`, so no new monorepo framework or alternate package manager is required.

### 8.2 Dependency/version policy

Structural import must not opportunistically align Menu with Operations versions. Menu may retain its compatible React 19.1, Vite 7, TypeScript 5.x, Tailwind 4, Supabase JS, Wouter, shadcn/Radix, and other existing dependencies while Operations keeps its own declared versions.

Dependency convergence or upgrades require separate evidence and scope. Root dependency resolution must not silently change existing Operations direct dependency declarations.

### 8.3 Lockfile authority

Current-tree authority becomes one root npm lockfile:

```text
/package-lock.json
```

The sequence is outcome-constrained:

- integrate `@tux/menu` into root workspace resolution;
- generate/update the root lock deterministically;
- prove a clean root `npm ci` succeeds using only the root lock;
- prove all required workspace builds/typechecks execute from that install;
- only then remove the current-tree `apps/menu/package-lock.json`;
- add a permanent guard that fails if nested workspace lockfiles reappear.

Removing the nested lockfile before root reproducibility is proven is prohibited.

## 9. Phase A legacy SQL quarantine

The pristine history import must first preserve the source snapshot, including the source repository's `supabase_setup.sql`. Immediately after the import boundary, current HEAD must quarantine it as explicitly non-executable/non-authoritative reference material, for example under an app-local `legacy/` location with a non-`.sql` executable filename and explanatory README.

The quarantine must state:

- it documents the historical TUX-MENU backend only;
- it must not be run against the canonical TUX Supabase project;
- it is not part of the canonical migration chain;
- its table/ID/price/storage assumptions conflict with the canonical schema;
- catalog migration requires the later Phase B design.

Permanent architecture guards must reject:

- executable legacy `supabase_setup.sql` files in app/package trees;
- nested `supabase/migrations/` authorities outside canonical root `supabase/migrations/`;
- any mechanism that automatically applies the quarantined reference SQL.

**No Phase A commit may alter canonical `supabase/migrations/` or apply any remote migration.**

## 10. Application and shared-package boundaries

### 10.1 Forbidden app-to-app implementation dependencies

The default dependency rule is:

```text
apps/*
  -> packages/application or packages/platform-contracts/domain as appropriate
  -> server/API boundary
  -> canonical data authority
```

Forbidden by default:

```text
apps/menu  -> apps/operations
apps/admin -> apps/operations
apps/operations -> apps/menu
apps/* -> another apps/* implementation
```

A permanent architecture guard must detect cross-app source imports and fail unless a future architecture explicitly approves a narrow exception.

### 10.2 App-local concerns

The following remain app-local unless later evidence justifies extraction:

- Menu routing and customer presentation;
- Menu cart UI/state;
- Menu-specific Tailwind/shadcn/Radix presentation code;
- Admin forms, editor UX, navigation, and administrative presentation;
- Operations renderer UI;
- Electron shell code;
- deployment-specific browser or desktop integration.

### 10.3 Shared concerns

Shared packages are for stable semantics, not convenience dumping grounds. Appropriate shared concerns include canonical IDs, money, catalog entities, modifier/combo contracts, request/response contracts, application use-case boundaries, and authorization/domain concepts where multiple applications truly consume the same semantics.

Phase A does not manufacture new shared catalog abstractions merely to bridge the legacy Menu model. Existing canonical types remain canonical; legacy Menu types stay app-local until Phase B establishes a real mapping/cutover.

A generic catch-all `shared` package is explicitly rejected.

## 11. Environment-variable and secret ownership

### 11.1 Phase A Menu legacy runtime

For behavior preservation, Menu may continue to use its existing legacy public Supabase connection during Phase A. Its browser-owned variables are:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

They belong to the Menu deployment environment, not the Operations server environment. Documentation must stop claiming that the dynamic legacy Menu requires no variables.

### 11.2 Operations server secrets

Existing server-only variables such as `TUX_SUPABASE_URL` and `TUX_SUPABASE_PUBLISHABLE_KEY` retain their existing ownership and must not be republished under `VITE_*` names merely to make Menu work.

### 11.3 Security invariant

No service-role, private API key, Meta secret, database password, or equivalent privileged credential may be bundled into Menu or future Admin browser code. Long-term privileged Admin operations belong behind server-side authorization/API boundaries established in Phases B/C.

## 12. Deployment topology

### 12.1 Independently deployable applications

One repository does not imply one deployment. Operations, Menu, and future Admin remain independently deployable applications.

### 12.2 Operations deployment

The existing Operations Vercel project/config remains authoritative for Operations and `/api`. Phase A must not repurpose its build/output/cron configuration into a combined frontend deployment.

### 12.3 Menu deployment

Menu gets a separate deployment project connected to the same canonical repository. Its configuration must:

- build only `@tux/menu`/`apps/menu`;
- consume the canonical root workspace dependency graph and root lockfile;
- publish the Menu `dist` output;
- preserve SPA fallback/direct deep-route semantics equivalent to the existing Menu deployment;
- own only Menu browser environment variables;
- avoid importing Operations server secrets;
- support independent preview/production promotion.

The exact Vercel root-directory/install-command configuration is an implementation choice only after proving that it consumes the root lockfile. A deployment setup that requires reintroducing `apps/menu/package-lock.json` is not acceptable.

### 12.4 Future Admin deployment

Phase C introduces a separate Admin deployment boundary. It must be possible to protect/administer it independently from the public Menu deployment and enforce canonical server-side authorization.

## 13. CI topology and permanent architecture guards

### 13.1 Existing gates remain authoritative

Phase A must not remove, skip, downgrade, or weaken existing Operations checks. Existing quality, edge-security, Windows package, and required-quality-gate semantics remain in force.

### 13.2 Menu CI evidence

Permanent CI must independently prove Menu:

- resolves from clean root `npm ci`;
- typechecks;
- production-builds;
- boots as a rendered application;
- renders representative public routes;
- resolves static assets without broken requests;
- handles direct/deep-route requests according to deployment rules;
- temporarily renders the legacy `/admin` login boundary during Phase A without performing destructive DB mutations in CI.

At minimum rendered characterization covers:

```text
/
/order-now
representative category/product route (for example /tux-burger)
/admin
```

### 13.3 Architecture guard

Permanent CI must fail on at least:

- forbidden `apps/* -> apps/*` implementation imports;
- nested workspace `package-lock.json` files at current HEAD;
- executable legacy `supabase_setup.sql` outside canonical migration authority;
- nested/second `supabase/migrations/` authorities;
- omission of `@tux/menu` from required root build/typecheck/CI coverage.

The architecture guard itself must be tested with positive/negative fixtures or equivalent strict TDD so it cannot be satisfied by a vacuous pattern.

### 13.4 Exact-head development evidence

The existing workflow trigger structure is centered on `main`/existing branches and PR #54 must not be modified merely to exercise Phase A. Phase A therefore must provide a safe permanent mechanism such as `workflow_dispatch` for running the same permanent gates on an explicitly selected `work/monorepo-foundation` exact HEAD. After integration into main, normal main/PR triggers must continue to exercise Menu and architecture gates automatically.

A branch-only temporary workflow that bypasses the real permanent gates is not sufficient evidence.

## 14. Test and verification strategy

### 14.1 Baseline principle

Before import/integration, record the latest legitimate target/source SHAs and obtain baseline evidence for both applications. A failure discovered before migration must be handled with `systematic-debugging`; it must not be silently attributed to the import or fixed by unrelated production changes.

### 14.2 Operations non-regression

At Phase A completion, exact-head evidence must include:

- existing unit/integration suite GREEN;
- typecheck GREEN;
- production build GREEN;
- existing rendered E2E GREEN;
- migration chain GREEN;
- WhatsApp architecture gate GREEN;
- WhatsApp security gate GREEN;
- edge-security checks GREEN;
- Windows packaging GREEN where applicable;
- no intended production changes under `apps/operations/` or `apps/operations-desktop/`;
- no Phase A changes to canonical Supabase migrations;
- no Meta changes.

A diff-scope guard or equivalent review evidence must prove Phase A's Operations behavior remains unchanged while allowing necessary root workspace/lockfile/CI/script/documentation edits.

### 14.3 Menu baseline and post-import proof

Before structural integration, source Menu must be characterized at approved source SHA with at least typecheck, production build, and rendered-route expectations. After import/workspace integration, the same behavior must be proven from the canonical root install.

Tests must detect more than TypeScript success. They must exercise actual browser rendering, routing, asset loading, and direct route entry.

### 14.4 Install proof

Final Phase A installation evidence must start from a clean dependency state and run `npm ci` at repository root against the canonical root lockfile. A successful developer machine with pre-existing `node_modules` is not sufficient.

### 14.5 Verification discipline

New guards/configuration behavior follows strict TDD. Any unexpected baseline/migration failure uses `systematic-debugging`. No GREEN/completion claim is permitted before `verification-before-completion` is invoked and fresh exact-head evidence is inspected.

## 15. Rollback and reversibility

### 15.1 Before merge to canonical main

`work/monorepo-foundation` is isolated from the WhatsApp live source branch and main. If Phase A is rejected, the branch can be abandoned without rewriting or reverting source branches.

### 15.2 History import rollback

The source rewrite occurs only in a disposable TUX-MENU clone. The independent source repository remains unchanged. Within the canonical branch, the unrelated-history import and subsequent workspace integration are normal commits/merge history and can be reverted through ordinary Git mechanisms; canonical pre-existing history is never rewritten.

### 15.3 Deployment rollback

The independent TUX-MENU repository and its production deployment remain available until canonical Menu deployment has been accepted. Domain/deployment cutover must therefore occur only after canonical preview verification, and retirement is deferred to Phase E.

### 15.4 Data rollback

Phase A performs no production Supabase write and no schema migration, so it creates no database rollback requirement. Data migration/rollback strategy is a Phase B/D responsibility.

## 16. Explicit Phase A non-goals and scope freeze

Phase A must not implement or modify:

- Task 10A phone-contract correction;
- React key cleanup from prior WhatsApp QA;
- unrelated exact-HEAD WhatsApp CI corrections;
- Real Meta acceptance;
- WhatsApp redesign;
- production Meta configuration;
- production Supabase state;
- remote Supabase migrations;
- canonical catalog data migration;
- new Menu features or visual redesign;
- new Admin features or visual redesign;
- new online-order functionality;
- dependency modernization;
- app-to-app coupling;
- a second migration authority;
- a generic legacy Product/shared model.

The scope freeze remains until Phase A is accepted or separately amended.

## 17. Phase A completion criteria

**Monorepo Foundation Completion** requires all of the following:

### Repository/provenance

- `work/monorepo-foundation` is based on the approved/latest legitimate WhatsApp live source checkpoint;
- exact final HEAD/tree/parent are recorded;
- original TUX-MENU source HEAD/tree are recorded;
- rewritten import SHA is recorded;
- import merge SHA is recorded;
- imported source history is traceable;
- pristine imported snapshot provenance is verified;
- canonical pre-existing history has not been rewritten;
- final Git worktree is clean.

### Workspace/install

- `apps/menu` exists as `@tux/menu`;
- npm workspaces remain the monorepo mechanism;
- clean root `npm ci` succeeds using the single root lockfile;
- no nested current-tree package lock remains;
- no opportunistic dependency modernization was required.

### Data authority

- `supabase/migrations/` remains the only migration authority;
- legacy Menu SQL is quarantined as non-executable reference material;
- canonical migration files are unchanged by Phase A;
- no production/remote Supabase write occurred.

### Operations

- existing full tests GREEN;
- typecheck GREEN;
- build GREEN;
- rendered E2E GREEN;
- migration chain GREEN;
- WhatsApp architecture/security GREEN;
- edge-security GREEN;
- Windows package GREEN;
- Operations behavior/source scope is unchanged except separately approved non-behavioral root integration mechanics.

### Menu

- root-workspace install resolves Menu;
- Menu typecheck GREEN;
- Menu production build GREEN;
- representative rendered route smoke tests GREEN;
- static assets resolve;
- direct/deep route behavior is verified;
- temporary legacy `/admin` behavior remains characterized for transition.

### Architecture/CI

- permanent cross-app import guard GREEN;
- migration-authority guard GREEN;
- nested-lockfile guard GREEN;
- legacy-executable-SQL guard GREEN;
- workspace/CI inclusion guard GREEN;
- existing Operations gates were not weakened;
- exact-head permanent CI evidence is available.

Meeting these criteria completes Phase A only.

## 18. TUX Monorepo Program completion criteria

The **TUX Monorepo Program is not complete** until Phase A criteria plus all of the following are true:

- canonical catalog/API authority is implemented and accepted;
- Operations, Menu, and Admin share one explicit catalog/business truth;
- `apps/admin` exists as a standalone application;
- Admin authorization is enforced server-side against canonical authority;
- Admin no longer performs direct legacy Supabase catalog CRUD;
- Admin implementation is not bundled into public Menu;
- Menu no longer depends on the legacy catalog database model;
- Admin no longer depends on the legacy catalog database model;
- one canonical Supabase migration chain remains authoritative;
- public Menu is cut over to canonical TUX catalog authority;
- the old independent TUX-MENU repository is retired only after production verification and explicit approval.

This distinction between Foundation Completion and Program Completion is binding.

## 19. Risks and mitigations

### Risk: source history is lost or obscured

Mitigation: filtered full-history import from a disposable clone, tracked source/rewrite/merge provenance, and no squash/copy fallback without approval.

### Risk: imported code immediately fails root lint/format rules

Mitigation: preserve root quality rules; after the pristine import boundary, make the smallest behavior-neutral compatibility corrections required. Do not weaken root lint rules to accommodate legacy code.

### Risk: root dependency resolution changes Operations unexpectedly

Mitigation: preserve workspace-declared versions, avoid modernization, compare existing Operations dependency declarations/resolution where relevant, and rerun all Operations gates after root lock generation.

### Risk: nested lockfile is removed too early

Mitigation: delete it only after clean root `npm ci` proves deterministic installation.

### Risk: legacy SQL is mistaken for canonical migration authority

Mitigation: quarantine after pristine import, rename to non-executable reference form, document incompatibility, and add permanent guards.

### Risk: `/admin` transition is mistaken for approved final architecture

Mitigation: state explicitly that Admin extraction is mandatory Phase C and that overall program completion requires standalone `apps/admin` on canonical authority.

### Risk: Menu deployment breaks deep links after monorepo move

Mitigation: preserve SPA rewrite semantics and test direct navigation to representative routes in deployed/preview-equivalent conditions.

### Risk: browser secrets are expanded during integration

Mitigation: keep browser and server environment ownership separate; never expose service-role/private credentials; move privileged Admin mutations behind server boundaries in later phases.

### Risk: stacked branch cannot exercise permanent CI

Mitigation: provide a permanent exact-ref workflow invocation mechanism rather than modifying PR #54 or creating a bypass workflow.

## 20. Design decisions resolved

The following decisions are intentionally closed for Phase A:

1. **Import method:** filtered history-preserving import is preferred; non-squashed subtree is fallback only if filter-repo is unavailable.
2. **Target path:** `apps/menu`.
3. **Workspace manager:** existing npm workspaces.
4. **Current-tree lock authority:** one root `package-lock.json` after reproducibility proof.
5. **Dependency policy:** preserve Menu versions; modernization is separate.
6. **Admin:** temporary `/admin` may remain in Menu for Phase A; standalone `apps/admin` is mandatory Phase C/program state.
7. **Catalog:** no legacy/canonical model unification in Phase A.
8. **Database:** root `supabase/migrations/` only; legacy SQL quarantined; no remote changes.
9. **Deployment:** Operations and Menu are separate deployable projects from one repository; Admin becomes a separate deployable app in Phase C.
10. **Shared code:** share stable semantics/contracts only; no app-to-app imports and no generic shared dumping ground.
11. **Security:** no privileged browser secrets; future Admin mutations require canonical server-side authorization.
12. **Repository retirement:** independent TUX-MENU is retained until Phase E criteria and explicit approval.

## 21. Ambiguities intentionally deferred to later phase designs

The following are not unresolved Phase A requirements; they are deliberately deferred architectural decisions because choosing them now would collapse later phases into Foundation:

- exact canonical public catalog API shape and transport;
- exact Admin command API shape;
- exact canonical role/permission model beyond the server-side authorization requirement;
- exact legacy TEXT-ID to canonical UUID mapping/data migration algorithm;
- final canonical image bucket/key policy and migration mechanics;
- public Menu fallback/cutover strategy during Phase D;
- final Admin hosting/access-control mechanism beyond independent deployment and server-side authorization.

Each must be resolved in the relevant Phase B/C/D design before implementation of that phase.

## 22. Approval and next workflow gate

This document is the binding design for **Phase A — Monorepo Foundation** once explicitly approved by the user.

After written-spec approval, the next Superpowers step is `writing-plans` to create:

```text
docs/superpowers/plans/2026-09-06-tux-monorepo-foundation.md
```

No TUX-MENU import, production-code change, Supabase change, Meta change, or implementation execution is authorized by this design document alone.
