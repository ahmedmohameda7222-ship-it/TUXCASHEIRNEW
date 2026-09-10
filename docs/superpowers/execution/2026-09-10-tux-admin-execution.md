# TUX Admin Execution Ledger

**Program:** TUX Admin control plane  
**Execution start:** 2026-09-10  
**Active plan:** Plan 1 — Foundation/Auth/Shell  
**Active branch:** `feat/admin-01-foundation`  
**Base main commit:** `3c19f13ae1f7adca69de0b5a511c99f534908824`

## Authority and execution rules

Implementation follows, in order of authority: production/business safety; `docs/superpowers/specs/2026-09-10-tux-admin-design.md`; the master plan; the active numbered plan; all mandatory hardening addenda; existing repository conventions; normal engineering judgment.

Operations remains live execution authority, Menu remains customer-facing authority, and canonical Supabase remains the only business source of truth. Browser code must never receive service-role/provider secrets. Admin mutations are network-only and server-authorized. Production deployment is prohibited until Plan 10 gates are complete.

## Planning preflight

Planning branch: `docs/tux-admin-design-spec-2026-09-10`  
Planning PR: #60 — `docs(admin): add approved TUX Admin specification and implementation plans`  
Final planning head: `d6c422a0f6f925e1a90595a01f6b0679d40240c1`  
Merged to main as: `3c19f13ae1f7adca69de0b5a511c99f534908824`

Final planning exact-head Actions run `34525750839` passed Menu rendered E2E, root rendered browser E2E, migration-chain smoke, edge/security checks, Windows packaging, typecheck/builds, and `Required quality gate`.

The final Codex review request for planning had entered processing when implementation was explicitly requested. All then-known Codex findings were already resolved before merge and are preserved below as implementation constraints.

## Local execution limitation

Direct local GitHub clone was unavailable because the execution container could not resolve `github.com`. GitHub connector writes are therefore the repository mutation path and GitHub Actions is the executable CI authority for RED/GREEN evidence. No task is accepted from static inspection alone.

## Repository rulings established before Plan 1

1. Root `tsconfig.api.json` originally included only root `api/**/*.ts` and `server/**/*.ts`; Plan 1 explicitly added `apps/admin/api/**/*.ts` and `apps/admin/server/**/*.ts` to the API/server typecheck authority.
2. Root npm workspaces include `packages/*`; `packages/admin-contracts` follows the existing source-export package convention.
3. Existing canonical `public.shops`, `shop_memberships`, `workers`, `business_days`, devices, orders/payments, inventory ledger, Menu, and Operations contracts are extended additively; they are not replaced by Admin models.
4. Thin Admin route files follow the repository's existing `IncomingMessage`/`ServerResponse` gateway convention.
5. Foundation Task 1 defines the stable reviewed permission union immediately; open-ended permission strings are not accepted.

## Codex planning findings and corrective rulings

All findings below were classified VALID and fixed in planning before the affected implementation gate.

1. Existing `inventory_movements` must be ALTERed additively, never recreated.
2. Every Admin credential/session/control table and RPC is browser-deny-by-default through RLS, privilege revocation, and service-role-only trusted RPC execution.
3. Approved command execution must be crash-recoverable through one SQL transaction where possible or a durable leased execution job through command idempotency.
4. Minimal finance account/movement primitives must exist before Workforce staff-payment acceptance; Plan 7 extends, never recreates, them.
5. Second-person approval requires a distinct approver; requester self-approval is forbidden even for OWNER.
6. Admin must never close an Operations-owned business day; Admin finance finalizes only from canonical CLOSED days.
7. Admin cancellation and Operations lifecycle writes share canonical CAS/revision authority; stale local transitions cannot overwrite the winner.
8. Checkout/minimum/tax/service/payment settings must reach real Menu/POS/ONLINE consumers and immutable order snapshots.
9. Loyalty/promotions must execute at real POS/ONLINE order-placement boundaries with atomic usage/balance control and immutable applied-rule snapshots.
10. Durable approval jobs require an independently invoked production runner.
11. Admin-origin inventory movements require a monotonic remote feed into Operations local SQLite plus durable cursor/conflict fencing.
12. Staff payment must contribute exactly once to salary expense/reporting as part of the same logical idempotent transaction.
13. Supplier payment status/balance requires immutable supplier-payment/allocation events tied atomically to finance movements.
14. Every scheduled Admin job requires an explicit authenticated production cron trigger and deployment-contract test.
15. Supplier payment allocations and purchase returns must serialize against canonical PO payable state.
16. Receipt identity/order-number settings must propagate to Operations numbering/printing while preserving numeric `displayOrderNo` compatibility and immutable snapshots.
17. Central reason codes must propagate into Operations and be validated/snapshotted at each applicable mutation boundary; free text is optional note only.
18. Approved employee PIN changes must use a secret-safe serializer; raw PINs and verifier/lookup material must never enter approval/audit/job/log payloads.
19. Canonical POS/ONLINE payments and refunds require an exactly-once projection into mapped finance accounts so tracked money reconciles to real sales/refunds.
20. The WhatsApp automatic event dispatcher requires a mandatory authenticated root Vercel cron entry and deployment test.
21. Admin cancellations require proactive Operations lifecycle pull/reconciliation on startup/reconnect/periodic online sync, not only conflict receipts after a local write.
22. Loyalty redemption and promotions consuming globally scarce state require idempotent canonical online reservation before local POS finalization; unavailable offline rather than oversubscribed.

## Plan 1 completion checklist

- [x] Task 1 — `@tux/admin-contracts` with stable roles, permission union, session/shop/command contracts.
- [x] Task 2 — business identity, Admin auth/permission/session schema with deny-by-default RLS/grants and trusted RPCs.
- [x] Task 3 — secure PIN-only Admin BFF/session, 8-failures/15-minute throttle, `/api/admin/reauth`, explicit API/server typecheck inclusion.
- [x] Hardening insertion after Task 3 — one-time service-role-only OWNER bootstrap with no default/source-stored production PIN.
- [x] Task 4 — `apps/admin` PWA workspace using existing Menu-compatible dependency versions.
- [x] Task 5 — session bootstrap, permission-aware routes, and shop context.
- [x] Task 6 — adaptive mobile-first Admin shell.
- [x] Task 7 — Foundation security/regression CI gate with dedicated Admin rendered E2E.

## Plan 1 TDD and verification evidence

### Task 1 — contracts

A failing contract import test was introduced first. RED run `34526962979` failed only because `packages/admin-contracts/src/auth.ts` did not yet exist. GREEN root CI run `34527851570` passed the new contracts together with the pre-existing suite.

### Task 2 — business/auth schema

RED run `34528308921` failed on the intentionally missing Admin auth migration. The implementation added `20260910100000_admin_business_auth.sql`, stable role/permission seeds, business/shop mapping, PIN/session tables, private throttle state, RLS/revokes, and service-role-only authorization/throttle RPCs. Focused run `34528647188` passed both static invariants and a fresh PostgreSQL migration-chain smoke.

### Task 3 — PIN-only BFF and sessions

RED suites covered PIN hashing/lookup, opaque sessions, CSRF, rate limiting, shop-safe authorization, and re-PIN. GREEN run `34530253246` passed all Admin security unit suites, contracts typecheck, Admin server/API typecheck, static migration invariants, and PostgreSQL migration-chain smoke.

Implementation uses PBKDF2-SHA256 with at least 210,000 iterations, HMAC-SHA256 lookup/rate keys, hash-only persisted session/CSRF material, HttpOnly SameSite=Lax cookies, same-origin mutation checks, service-role-only server access, and five-minute reauthentication freshness.

### Mandatory OWNER bootstrap

RED run `34530445981` failed specifically at the missing OWNER bootstrap invariant. The implementation added `20260910100100_admin_owner_bootstrap.sql`, `bootstrap_tux_admin_owner_v1`, `bootstrapOwner.ts`, and a hidden-input CLI that never accepts or prints a plaintext PIN. Exact-head run `34530691051` passed one-time database semantics, browser EXECUTE denial, service-role grant, migration smoke, unit tests, and API/server typecheck.

### Task 4 — Admin PWA

RED run `34530885164` had 21 existing/new Foundation tests passing and failed only because `App.tsx` did not yet exist. GREEN implementation added the `@tux/admin` React/Vite/Tailwind workspace, manifest, query client, base application surface, separate Vercel project config, and synchronized workspace lockfile. Subsequent focused gates passed `npm ci`, unit tests, frontend/server typechecks, production build, and PostgreSQL migration smoke.

### Task 5 — session routing and shop context

RED run `34531398304` failed only because `AdminSessionProvider` and `ShopScopeProvider` were absent while prior tests stayed green. GREEN implementation added same-origin `adminFetch`, in-memory CSRF session state, PIN login flow, permission-aware routing, one-shop automatic scope, OWNER-only `All Shops`, and a concrete-shop requirement for mutations. Focused run `34531599492` passed behavior tests, typechecks, and Admin production build.

### Task 6 — adaptive shell

RED run `34531750024` had 29 tests passing and failed only on the intentionally missing shell implementation. GREEN added phone bottom tabs, tablet compact sidebar, desktop full sidebar, permission-filtered navigation, top bar/shop context, responsive page/detail primitives, shared 44px touch-target tokens, and 390/768/1440 browser coverage. A readonly test-fixture type mismatch was corrected without runtime behavior changes.

### Task 7 — security and rendered browser gates

RED run `34532936623` passed the 32 Foundation tests and failed only because `test:admin-security` was intentionally not defined yet. Focused GREEN run `34533592025` passed unit tests, the Admin browser/BFF/RLS/RPC security guard, contracts/BFF/frontend typechecks, production build, migration smoke, and OWNER invariants.

The canonical catalog architecture guard was hardened so service-role use is permitted only inside the trusted `apps/admin/server/**` boundary and explicitly remains forbidden in `apps/admin/src/**`. The updated architecture suite passes.

The permanent Admin CI job now runs security checks, typecheck, production build, Chromium, PIN-login/shop-isolation browser tests, and responsive-shell browser tests. Full CI run `34534384841` demonstrated the dedicated Admin job GREEN, including all five Admin Playwright tests. That run also exposed two CI-discovery issues subsequently fixed: strict type-import lint and Vitest unintentionally discovering Playwright `e2e/admin-*.spec.ts` files. Playwright specs remain covered by the independent Admin browser job; root Vitest now excludes `e2e/**`.

### Deployment-boundary self-review

The initial Admin Vercel config was too thin for a workspace-based monorepo. It was hardened before Plan 1 acceptance to install and build from the repository root, preserve filesystem/API functions before the SPA fallback, and set `git.deploymentEnabled: false`. The Admin security gate now enforces those deployment invariants. Automatic Admin production deployment remains disabled until the Plan 10 release gate.

### Formatting and tooling evidence

Repository-format drift was corrected by running the repository's canonical `npm run format` through a temporary GitHub Actions formatter; the temporary workflow was deleted immediately afterward. The resulting exact-head `format:check` and strict ESLint gate subsequently passed.

### Codex availability

A review was requested on PR #61. The Codex bot reported that a Codex environment must first be created for this repository, so no executable Codex review was available for Plan 1. This is recorded as tool unavailability, not treated as a passing review. Plan 1 therefore relies on TDD, static security/architecture guards, PostgreSQL migration execution, rendered browser tests, full repository CI, and manual/self-review evidence.

## Final Plan 1 acceptance gate

The final acceptance head is the commit containing this ledger update together with all Plan 1 implementation and self-review fixes. Acceptance requires one exact-head `TUX V2 CI` run with all permanent jobs green, including `quality`, `admin`, `edge-security`, `windows-package`, `menu`, `monorepo-architecture`, and `Required quality gate`. The exact run is recorded in the PR checks; Plan 1 must not merge until that gate is green.
