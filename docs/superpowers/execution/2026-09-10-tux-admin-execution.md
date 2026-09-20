# TUX Admin Execution Ledger

**Program:** TUX Admin control plane  
**Execution start:** 2026-09-10  
**Active plan:** Plan 2 — Catalog/Publishing/Settings  
**Active branch:** `feat/admin-02-catalog-settings`  
**Base main commit:** `96d7bb26d5c738859036c0f75c035e664e447f31`

## Authority and execution rules

Implementation follows, in order of authority: production/business safety; `docs/superpowers/specs/2026-09-10-tux-admin-design.md`; the master plan; the active numbered plan; all mandatory hardening addenda; existing repository conventions; normal engineering judgment.

Operations remains live execution authority, Menu remains customer-facing authority, and canonical Supabase remains the only business source of truth. Browser code must never receive service-role/provider secrets. Admin mutations are network-only and server-authorized. The Operations Vercel cutover was verified with production deployment `dpl_9M6i179C83S6Hzry2rumFm9Tqx68` in `READY` state on the existing production alias. The legacy root `/vercel.json` is removed in the deployment-isolation cleanup. Admin may now be created as a separate Vercel project rooted at `apps/admin`; the Admin repository contract permits main-only deployments while PR and feature-branch previews remain disabled. Final production acceptance remains gated by Plan 10, so a pre-Plan-10 Admin deployment is not by itself an accepted production release.

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

The initial Admin Vercel config was too thin for a workspace-based monorepo. It was hardened before Plan 1 acceptance to install and build from the repository root and preserve filesystem/API functions before the SPA fallback. Operations was then prepared with an equivalent app-local contract and recursively mirrored API entrypoints, the existing Operations Vercel project was moved to Root Directory `apps/operations` with outside-root source access, and production deployment `dpl_9M6i179C83S6Hzry2rumFm9Tqx68` reached `READY` on the existing production alias. The legacy repository-root `/vercel.json` is removed by the follow-up isolation cleanup, leaving `apps/operations/vercel.json`, `apps/menu/vercel.json`, and `apps/admin/vercel.json` as independent project contracts. Admin may now be created as a separate Vercel project rooted at `apps/admin`. The Admin app-local contract permits Git deployment from `main` only while PR and feature-branch previews remain disabled. The Admin security/deployment gates enforce those invariants. Final production acceptance remains gated by Plan 10.

### Formatting and tooling evidence

Repository-format drift was corrected by running the repository's canonical `npm run format` through a temporary GitHub Actions formatter; the temporary workflow was deleted immediately afterward. The resulting exact-head `format:check` and strict ESLint gate subsequently passed.

### Codex availability

A review was requested on PR #61. The Codex bot reported that a Codex environment must first be created for this repository, so no executable Codex review was available for Plan 1. This is recorded as tool unavailability, not treated as a passing review. Plan 1 therefore relies on TDD, static security/architecture guards, PostgreSQL migration execution, rendered browser tests, full repository CI, and manual/self-review evidence.

## Final Plan 1 acceptance gate

The final acceptance head is the commit containing this ledger update together with all Plan 1 implementation and self-review fixes. Acceptance requires one exact-head `TUX V2 CI` run with all permanent jobs green, including `quality`, `admin`, `edge-security`, `windows-package`, `menu`, `monorepo-architecture`, and `Required quality gate`. The exact run is recorded in the PR checks; Plan 1 must not merge until that gate is green.

## Plan 2 completion checklist

- [x] Task 1 — additive master catalog, draft/version, publish, schedule, and recurring-availability control schema over the existing canonical shop catalog.
- [x] Task 2 — trusted typed Admin catalog contracts/BFF commands with shop authorization, permission checks, and version fencing.
- [x] Task 3 — responsive catalog management UI with draft editing, progressive disclosure, and immediate availability controls.
- [x] Task 4 — publish preview/history, restore-as-new-version, Cairo scheduling, recurring availability, authenticated scheduler trigger, and deployment-contract coverage.
- [x] Task 5 — canonical Shops/Order Types/Payments/Checkout/Receipts/Reason Codes settings authority with real Menu/Operations propagation and rendered Admin settings management.

## Plan 2 authority and safety rulings

1. Plan 2 extends the existing canonical catalog and settings authorities; it does not create a second runtime truth. Menu and Operations consume published/effective state only.
2. Browser code uses the same-origin Admin BFF. Service-role access and canonical settings RPC execution remain inside trusted server boundaries.
3. Plan 2 catalog/settings migrations are additive repository artifacts and are applied to canonical Supabase only after exact-head CI, PostgreSQL behavior, production-safety, and live-readback verification. Canonical production is synchronized through repository migration `20260910123100`.
4. Settings row edits are optimistic-concurrency writes. `settingsVersion` fences the published settings base and row `editVersion` fences the individual canonical Order Type or Payment Method.
5. Payment operational semantics are not editable through the normal settings surface. `logicType`, `requiresReconciliation`, and integration identity remain protected/read-only; editable fields are limited to policy that has a trusted runtime boundary; unenforced policy remains non-editable.
6. Order Type edits are limited to name, behavior, active state, and sort order.
7. Draft/settings changes do not become live merely because an Admin row edit succeeds; the existing publish boundary remains authoritative. Emergency operational-state publication and approved SHOP_CONFIG schedules use dedicated trusted paths that do not leak unrelated staged edits.

## Plan 2 Task 5 TDD and hardening evidence

The canonical settings edit boundary was implemented through explicit RED→GREEN cycles across database, service, BFF, client, rendered UI, Operations/Menu consumers, scheduler execution, and canonical PostgreSQL behavior.

### Canonical row edit schema and migration-chain safety

A failing migration invariant first required canonical Order Type and Payment Method edit RPCs, per-row `edit_version`, stale-row rejection, stale-published-base rejection, immutable protected payment semantics, and browser EXECUTE denial. The additive implementation introduced `update_admin_order_type_v1` and `update_admin_payment_method_v1` as service-role-only, version-fenced trusted writes.

Repository migration smoke then exposed a real duplicate Supabase migration version: the first row-edit migration used `20260910120100`, which already belonged to `admin_settings_commands.sql`. The row-edit migration was therefore moved deterministically after the existing `120100` and `120200` migrations to `20260910120300_admin_canonical_settings_row_edits.sql`; the obsolete duplicate was deleted and the dedicated migration test was updated. The complete repository migration chain and dedicated shop-settings PostgreSQL behavior subsequently passed.

### Trusted service/BFF command boundary

Service contracts were extended with typed Order Type and Payment Method edit inputs/results. Focused RED tests required trusted dispatch and proved that payment operational fields must not cross the mutation boundary. Strict BFF Zod schemas and dispatch were then added for `order-type.update` and `payment-method.update`, including positive integer CAS versions and rejection of extra/protected fields. Service, contracts, and API/server typechecks passed after GREEN.

### Workspace and client CAS authority

RED workspace/client regressions established that each editable row or form must retain the CAS snapshot captured with the local edit. Order Type, Payment Method, setting override, reason-code, weekly-hours, and special-hours editors preserve dirty snapshots so refreshes produce stale-version conflicts rather than silent overwrites, while pristine editors synchronize to refreshed canonical state. Client mutations invalidate/refetch the workspace after successful edits.

### Rendered settings management

Rendered E2E requires actual operator workflows for Order Types, Payment Methods, checkout policies, receipt identity/numbering, reason codes, canonical shop identity, emergency state, service hours, scheduled settings publication, and durable schedule outcome visibility. The UI remains a same-origin BFF client and does not introduce direct browser database writes.

### Runtime authority and immutable evidence

Published checkout policy reaches trusted POS and ONLINE placement, including minimum order, service charge, tax, discount stacking authority, delivery-fee override, customer-phone requirement, payment channel/zone/reference/manual-confirmation policy, and immutable snapshots. Receipt identity/sequence configuration affects future allocation/printing and persisted historical orders retain their original evidence. Configured cancellation, delivery-return, and cash-variance reason identities are validated and snapshotted through application and remote materialization paths.

Published ONLINE weekly/special hours are evaluated consistently by trusted order intake and public Menu ordering projection in `Africa/Cairo`, including second/fractional-second boundaries. Emergency closure/online-pause publication patches only immutable published state and cannot leak mutable staged settings.

### SHOP_CONFIG scheduling and Round 14 hardening

The approved settings scheduling path supports immutable staged-settings publication plus future online-order pause/resume. Schedule acceptance requires `settings.manage` and the expected published settings version. Execution uses durable claim/idempotency/attempt/replay fences and `shop_settings_versions.scheduled_change_id`.

Round 14 established explicit settings-publication lineage. Accepted SHOP_CONFIG actions may rebase across `EMERGENCY_OPERATIONAL_STATE`, `SCHEDULED_SETTINGS_PUBLISH`, and `SCHEDULED_ONLINE_ORDERS_STATE`; ordinary/manual `SETTINGS_PUBLISH` remains a stale barrier. Full scheduled settings preserve the current emergency `temporaryClosed` and `onlineOrdersPaused` flags at activation time. Distinct future SHOP_CONFIG actions coexist; only an exact idempotency-key match is replay. The durable settings workspace projects PENDING/CLAIMED/APPLIED/CANCELLED, retryable failure, terminal failure, retry timing, attempt count, and stored error details so reload cannot hide a failed advertised activation.

RED evidence for the Round 14 acceptance regressions is Admin Catalog Settings TDD run `35077658613`, catalog-ui job `104733783738`, which failed the newly wired durable-outcome/lineage tests before implementation.

### Round 15 final-review closure

Fresh Codex review submission `5221372288` on the ledger-predecessor head found two valid final blockers: overdue same-shop SHOP_CONFIG actions could be claimed together and execute out of chronological order after a retryable predecessor failure; and one-shot Cairo wall-clock schedules silently accepted DST-gap and repeated local timestamps.

Round 15 was isolated in PR #77 on branch `fix/admin-plan2-round15-review`. RED run `35084898288`, PostgreSQL job `104757301881`, reproduced both defects on the unfixed repository chain: the same-shop pair reached `pause=CLAIMED, resume=CLAIMED`, and invalid Cairo local-time probes changed durable SHOP_CONFIG row count from `0` to `2`.

Additive migration `20260910123100_admin_plan2_final_review_round15_hardening.sql` introduced strict `private.resolve_admin_cairo_schedule_v1`, wrapped both Catalog draft scheduling and SHOP_CONFIG scheduling with that resolver, and added a same-shop SHOP_CONFIG predecessor fence to `claim_due_admin_config_changes_v1`. Retryable PENDING/CLAIMED/FAILED predecessors now block later actions; APPLIED/CANCELLED/terminal FAILED predecessors release them. Nonexistent Cairo times fail strict round-trip validation and repeated local times are rejected rather than silently disambiguated.

Isolation head `3cf82e962f720a880f775c64b32b83b5dca7a36b` was GREEN in Round 15 `35086445497`, Foundation `35086445452`, Catalog Settings `35086445528`, and Boundary `35086445435`. PR #77 was then promoted into Plan 2 as merge SHA `068684e25db51f2dc186eb74905292ba5c0938e7`.

## Plan 2 production migration and readback evidence

Canonical Supabase project `awpdcsayuwbsruwvaosg` is synchronized through exact repository migration `20260910123100`, including the final scheduler lineage/order/time-validation migrations:

- `20260910122700_admin_plan2_final_review_round13_hardening.sql`
- `20260910122800_admin_plan2_round13_scheduler_ordering_fix.sql`
- `20260910122900_admin_plan2_final_review_round14_hardening.sql`
- `20260910123000_admin_plan2_round14_sequence_followup.sql`
- `20260910123100_admin_plan2_final_review_round15_hardening.sql`

Round 14/15 live readback confirms:

- `shop_settings_versions.settings_publication_kind` exists, is `text NOT NULL`, and is constrained to `SETTINGS_PUBLISH`, `EMERGENCY_OPERATIONAL_STATE`, `SCHEDULED_SETTINGS_PUBLISH`, and `SCHEDULED_ONLINE_ORDERS_STATE`.
- `update_admin_shop_operational_state_v1` writes `EMERGENCY_OPERATIONAL_STATE`.
- `private.schedule_admin_shop_config_v1` uses exact idempotency replay and does not bulk-cancel distinct pending future SHOP_CONFIG actions.
- `apply_scheduled_shop_config_change_v1` permits the three safe intervening lineage kinds and retains `stale_settings_version` for ordinary/manual publication.
- `claim_due_admin_config_changes_v1` claims `SHOP_CONFIG` while retaining the earlier unresolved recurring-EXIT predecessor fence and now also serializing each shop's SHOP_CONFIG actions behind its earliest unresolved predecessor.
- `private.resolve_admin_cairo_schedule_v1` is live; production timezone probes dynamically discovered `2027-04-30 00:00` as nonexistent and `2027-10-28 23:00` as ambiguous, returning `scheduled_local_time_nonexistent` and `scheduled_local_time_ambiguous` respectively, while ordinary `2027-01-15 12:00` resolved normally.
- the public Catalog schedule wrapper and private SHOP_CONFIG schedule wrapper both call the strict resolver before durable insertion.
- `anon` and `authenticated` cannot execute the public Catalog schedule or claim RPCs; `service_role` can. The pre-Round15 legacy Catalog scheduler is not directly executable by browser roles or `service_role`.
- the live SHOP_CONFIG row count was `0` at final production readback, so no legacy pending jobs required migration/backfill handling.
- the post-DDL Supabase security advisor reported no new Round15-specific exposed-function finding; its reported RLS/public-catalog/worker-function/password warnings remain pre-existing project-level advisory items rather than Round15 regressions.

Both Round 15 Codex threads were answered with RED→GREEN, exact-head CI, canonical migration, ACL, scheduler-definition, and DST-probe evidence and then resolved.

## Plan 2 exact-head verification before ledger update

Exact promoted code head `068684e25db51f2dc186eb74905292ba5c0938e7` passed all five permanent workflows before this ledger mutation:

- `Admin Foundation TDD` run `35086604539` — SUCCESS.
- `Admin Catalog Settings TDD` run `35086604858` — SUCCESS, including Catalog/Settings UI/service tests, scheduler tests, the full hardening/migration PostgreSQL surface, trusted runtime authority regressions, Menu compatibility, and rendered Catalog/Settings E2E.
- `Admin Catalog Settings Boundary TDD` run `35086604449` — SUCCESS, including static boundary invariant and complete PostgreSQL migration-chain behavior.
- `Admin Plan 2 Round 15 TDD` run `35086604610` — SUCCESS, including the dedicated static invariant and fresh PostgreSQL behavior for SHOP_CONFIG serialization and strict Cairo local-time validation.
- `TUX V2 CI` run `35086604638` — SUCCESS, including format, lint, full unit/integration suite, Admin/WhatsApp security and architecture gates, typecheck, production builds, provisioning safety, migration-chain smoke, Supabase function auth contract, Edge Function typecheck, Admin/Menu/root rendered E2E, Windows package, and `Required quality gate`.

All known Codex review threads on PR #62, including the Round 14 findings and the Round 15 P1 same-shop serialization/P2 Cairo wall-clock findings, were answered with RED→GREEN plus canonical production evidence and resolved before this ledger update.

## Plan 2 final review/merge gate

This ledger commit changes the PR head, so the evidence above is the final implementation evidence immediately before ledger closure, not permission to skip exact-head verification.

PR #62 must not merge until all of the following are true on the ledger-updated exact head:

1. `Admin Foundation TDD`, `Admin Catalog Settings TDD`, `Admin Catalog Settings Boundary TDD`, `Admin Plan 2 Round 15 TDD`, and `TUX V2 CI` are all SUCCESS.
2. A fresh Codex review is requested on that exact final head and produces no valid unresolved P0/P1/P2 findings. Any valid finding reopens TDD and production acceptance as appropriate.
3. Master Gate 2 is explicitly audited: Admin publish/version authority reaches Menu and Operations at the same published version; new orders snapshot the exact configuration evidence; historical orders remain immutable after later publishes; checkout/payment/receipt/shop settings affect their real consumers; reason-code identities validate/snapshot; receipt identity/numbering applies only prospectively; and the full Catalog/Settings regression surface remains GREEN.

After those gates pass, merge PR #62 using its exact expected head, verify post-merge `main` CI, then begin Plan 3 automatically in the approved execution order.

## Plan 2 final review Round 16 closeout — 2026-09-16

Fresh Codex review on exact Plan 2 head `c928f9499efc4be7ddbfa7aa5d1cf5ffb0c58dd1` identified three valid final blockers: fulfillment-specific service hours were not enforced by trusted online intake; SHOP_CONFIG schedule replay identity omitted the immutable settings snapshot; and recurring availability still relied on direct Cairo `AT TIME ZONE` conversion without an explicit gap/repeated-wall-clock policy.

Round 16 used isolated RED→GREEN execution on PR #78 (`fix/admin-plan2-round16-review`). RED run `35091455116` proved all three defects: closed DELIVERY/PICKUP fulfillment windows were accepted, changed settings snapshot B replayed snapshot A at the same activation identity, and a Cairo DST-gap recurring occurrence materialized transitions instead of rejecting the invalid wall clock.

The fix generalized trusted intake hour evaluation while retaining the ONLINE gate and adding fulfillment-specific DELIVERY/OPEN gates. Additive migration `20260910123200_admin_plan2_final_review_round16_hardening.sql` hashes the immutable settings payload into SHOP_CONFIG idempotency and resolves both recurring ENTER/EXIT wall clocks through `private.resolve_admin_cairo_schedule_v1`; if either boundary is nonexistent or ambiguous, the entire occurrence is skipped so no silent normalization or one-sided state can occur. During GREEN debugging, the hardened function search path correctly exposed an unqualified `digest()` lookup failure; the final implementation uses schema-qualified `extensions.digest(...)` without widening `search_path`.

Isolation exact head `27ad099e2fa5e9c196ac58faaa6800c0292cf25e` passed all five isolation gates: Round16 `35093363262`, Round15 `35093363203`, Catalog Settings `35093363274`, Foundation `35093363248`, and Boundary `35093363198`. PR #78 was promoted with merge commit `043171e7875757716231c80d50d229370737c2b6`.

The first promoted root run exposed one obsolete Round 2 source assertion that required the former literal ONLINE-only implementation. That regression test was updated, without changing production behavior, to assert the generic service-kind evaluator, explicit ONLINE invocation, and DELIVERY/OPEN fulfillment mapping. Final pre-ledger Plan 2 head `fc30053e38f64101abdfe4eb9fab2518fbe39a41` is 6/6 green: Foundation `35093889387`, Catalog Settings `35093889381`, Boundary `35093889448`, Round15 `35093889377`, Round16 `35093889486`, and root TUX V2 CI `35093889370`. Root unit/integration, security, typecheck, production builds, migration smoke, Edge typecheck, Admin/Menu rendered E2E, root rendered browser E2E, Windows package, and required quality gate all passed.

Canonical Supabase project `awpdcsayuwbsruwvaosg` is synchronized exactly through repository migration `20260910123200 admin_plan2_final_review_round16_hardening`. Live readback confirms SHOP_CONFIG payload digest identity, strict recurring Cairo resolver usage, whole-occurrence DST skip policy, and ACL boundaries. Live resolver evidence: `2027-04-30 00:00` returns `scheduled_local_time_nonexistent`; `2027-10-28 23:00` returns `scheduled_local_time_ambiguous`; ordinary `2027-01-15 12:00` resolves successfully. `materialize_recurring_availability_changes_v1` is executable by service_role but not anon/authenticated; the legacy private scheduler core is not directly executable by anon/authenticated/service_role. Post-DDL security advisor output contains the existing project-level RLS/public-catalog/auth warnings and no new Round16-specific finding.

The order-intake change is Edge/source behavior. No independent production Edge deployment was performed during this closeout because Plan 2's explicit production authorization covers the canonical migration path and the repository has no authorized Edge deployment workflow; the source behavior is covered by the Round16 behavioral test, Catalog online-order policy gate, root edge-security/typecheck, and root integration/rendered gates.

Round16 Codex threads `PRRT_kwDOT52lwc6i6AUJ`, `PRRT_kwDOT52lwc6i6AUU`, and `PRRT_kwDOT52lwc6i6AUb` were answered with RED→GREEN and production evidence and resolved after the production readback.

Final Plan 2 merge gate remains: this ledger-inclusive exact head must pass all six permanent workflows; a fresh exact-head Codex P0/P1/P2 review must return no valid unresolved blocker; Master Gate 2 must be explicitly audited; PR #62 must be merged with an expected-head SHA guard; and post-merge `main` CI must pass before Plan 2 is declared complete and Plan 3 begins.

## Plan 2 final review Round 17 closeout — 2026-09-16

A fresh exact-head Codex review on Plan 2 head `b77093e82542594cc16c92ad1453df6b096423fc` identified one valid P2: `read_catalog_public_ordering_v2` still advertised PICKUP and DELIVERY from active order types without applying the same fulfillment-specific OPEN/DELIVERY service-hour authority already enforced by trusted Round 16 order intake. That allowed Menu to advertise a fulfillment option that trusted intake could reject after submit.

Round 17 used isolated RED→GREEN execution on PR #79 (`fix/admin-plan2-round17-review`). RED run `35097595576` reproduced the defect with an explicit DELIVERY closure: the public projection returned `["PICKUP","DELIVERY"]` instead of hiding Delivery.

Additive migration `20260910123300_admin_plan2_final_review_round17_hardening.sql` introduces `private.catalog_public_service_kind_open_v1(p_settings jsonb, p_service_kind text, p_now timestamptz)` for `OPEN`, `DELIVERY`, and `ONLINE`. It preserves Africa/Cairo weekly/special-hours semantics, overnight carry, fractional-second precision through the existing local-second parser, fail-closed handling for malformed configured rows, and rollout-open behavior when no rows exist for that service kind. The prior ONLINE helper now delegates to this generic evaluator. `read_catalog_public_ordering_v2` appends PICKUP only when TAKE_AWAY is active and OPEN is currently open, and appends DELIVERY only when DELIVERY is active and DELIVERY is currently open; global ordering availability still requires lifecycle authority plus ONLINE open.

Isolation exact head `e8c6090c79130f04d58b9d2917622f57283a0ddf` passed Foundation `35097853535`, Round15 `35097853536`, Round16 `35097853577`, Round17 `35097853540`, Boundary `35097853602`, and Catalog Settings `35097853595`. PR #79 was promoted into Plan 2 as exact head `4d047acf83b21c9159928ded79f6d3dca2725929`.

The promoted exact head passed all seven permanent workflows before this ledger mutation:

- `Admin Plan 2 Round 15 TDD` run `35098054213` — SUCCESS.
- `Admin Plan 2 Round 16 TDD` run `35098054372` — SUCCESS.
- `Admin Foundation TDD` run `35098054443` — SUCCESS.
- `Admin Plan 2 Round 17 TDD` run `35098053970` — SUCCESS.
- `Admin Catalog Settings Boundary TDD` run `35098053969` — SUCCESS.
- `Admin Catalog Settings TDD` run `35098053959` — SUCCESS.
- `TUX V2 CI` run `35098053958` — SUCCESS, including Windows package, quality, monorepo architecture, edge security, Menu, Admin, Required quality gate, full unit/integration, typecheck/builds, provisioning/migration/function-auth smoke, Edge typecheck, and rendered browser E2E.

Canonical Supabase project `awpdcsayuwbsruwvaosg` is synchronized exactly through repository migration `20260910123300 admin_plan2_final_review_round17_hardening`. The generated production migration-history row was guardedly normalized to repository version `20260910123300` without rerunning DDL. Live production readback confirms the generic helper uses Cairo semantics and fractional-second parsing, explicit DELIVERY and OPEN closures evaluate false, no-hours DELIVERY/OPEN remain rollout-open, the ONLINE wrapper delegates to the generic evaluator, and the public projection applies OPEN to PICKUP and DELIVERY to DELIVERY. `anon` and `authenticated` retain intentional EXECUTE on the public ordering read RPC, while neither browser role can execute the new private helper.

Post-DDL Supabase security-advisor output is unchanged at the project baseline: no new Round17-specific private-helper finding was introduced. Existing advisory findings remain, including RLS-enabled/no-policy informational items, intentional public/authenticated SECURITY DEFINER warnings for public catalog and authenticated worker preference/layout functions, and leaked-password protection disabled; this closeout does not claim a fully clean project-wide advisor report.

The Round 17 Codex thread `PRRT_kwDOT52lwc6i7kKz` is resolved. Because the connector blocked an inline evidence reply, the same acceptance evidence was recorded as top-level PR #62 conversation comment `5698589983` before resolving the thread. All known PR #62 review threads are resolved at this point.

The Round 16 order-intake change remains Edge/source behavior. No independent production Edge deployment was performed during Plan 2 because the explicit Plan 2 production authorization covers the canonical migration path and the repository has no separately authorized Edge deployment workflow; source behavior remains covered by the permanent Round16/root Edge and integration gates.

Final Plan 2 merge gate after this ledger mutation: the resulting exact head must pass all seven permanent workflows; a fresh exact-head Codex P0/P1/P2 review must produce no valid unresolved blocker; Master Gate 2 evidence already recorded on PR #62 must remain satisfied; PR #62 must be merged with an expected-head SHA guard; and post-merge `main` CI must pass before Plan 2 is declared complete and Plan 3 begins automatically.


## Plan 4 execution start — 2026-09-19

**Plan:** `docs/superpowers/plans/2026-09-10-tux-admin-inventory-purchasing.md`  
**Branch:** `feat/admin-04-inventory-purchasing`  
**Base:** `469b5291c42ec6875daf59ee3f18cb5ae9478495` (includes the formatting-only baseline repair from PR #91)

Pre-flight shared interfaces:
- Tasks 1→2: Task 1 produces the canonical reservation/consumption/restore/release RPC and additive inventory ledger schema consumed by Operations lifecycle migration in Task 2.
- Tasks 1→3: Task 3 Admin inventory actions consume Task 1 ledger/RPC semantics; UI must never edit stock projections directly.
- Tasks 1/2→4: intelligence consumes Available = On Hand - Reserved and completed-order theoretical usage; reservations must not be subtracted twice.
- Tasks 1/4→5: purchasing receiving/returns post immutable movements into the same canonical ledger and feed weighted-average cost/incoming quantities.
- Mandatory hardening: OWNER-only emergency negative override is folded into Tasks 1–3; supplier-aware replenishment into Tasks 4–5; canonical Admin-origin inventory pull/convergence into Operations is required before Gate 4; central structured reason codes apply to waste/adjustment mutations.

Ruling: keep the repository migration filename `20260910130000_admin_inventory_ledger.sql` specified by the approved plan for deterministic local migration-chain ordering. Production Supabase already contains later Plan 3 history, so applying this change to production is a separate guarded side effect and must not be performed implicitly while implementing the branch. If production promotion uses an out-of-order history operation, it requires explicit deployment evidence/authorization at that checkpoint.


### Task 1: complete

Evidence at branch head `13f11221e70ca20996bcbb99bc1ee0421c19ad7a`:
- Plan 4 `ledger-static`: GREEN.
- Plan 4 `ledger-postgres`: GREEN; the seeded legacy `inventory_movements` row survived the additive migration unchanged apart from additive defaulted columns, legacy movement labels remained valid, and the new RLS/RPC contract applied on PostgreSQL 17.
- `npm run test:migrations`: GREEN in `task1-regression`.
- Baseline unit/integration regression excluding the already-authored Task 2 RED test: GREEN in `task1-regression`.
- The unfiltered pre-Task-2 run proved 319/320 test files and all 1554 executed tests passed; the only failed suite was `apps/admin/server/inventory/costing.test.ts`, intentionally RED because `costing.ts` had not yet been implemented.

Task 1 Ruling: Task 2 RED tests were authored before Task 1's final regression checkpoint, so the Task 1 completion gate excludes exactly `apps/admin/server/inventory/costing.test.ts`. This does not waive or hide any existing production regression; the file remains a mandatory RED→GREEN gate for Task 2. Cost if wrong: a non-Task-2 regression could be masked only if it were placed in that exact test file before Task 2 implementation, so Task 2 must run the file unexcluded and then the full suite.


### Plan 4 Task 2 rulings — inventory lifecycle

- Ruling: local SQLite availability follows the canonical PostgreSQL `reserve_inventory_for_order_v1` authority exactly: no prior movement means on-hand/available zero, so recipe reservations are blocked until stock is explicitly established. Existing checkout fixtures must seed opening stock rather than bypassing the rule. Cost if wrong: local Operations could accept orders that the server-side inventory authority rejects.
- Ruling: legacy ACTIVE orders created under placement-time `ORDER_CONSUMPTION` retain the explicit pre-reservation cancellation compatibility path; new reservation-backed orders release `ORDER_RESERVATION` regardless of `foodPrepared`. Cost if wrong: historical orders could either double-restore stock or lose their pre-migration cancellation semantics.
- Ruling: repeated `DONE → undo → DONE` cycles key each `ORDER_CONSUMPTION` by the target lifecycle revision plus item id, not by order+item alone. Cost if wrong: the second legitimate DONE transition collides with the immutable ledger idempotency key.
- Ruling: RETURNED/no-restock acceptance is anchored by the existing OrdersBoard SQLite integration test and is included in the Plan 4 targeted regression gate; the new reservation lifecycle test covers reserve/consume/undo/cancel and composes with that canonical return path rather than duplicating a weaker synthetic DONE fixture.


### Task 2: complete

Evidence at branch head `f829d6ea398b8eab5e0cf1ab9111c482e30ce65c`, Plan 4 workflow run `35418413550`:
- `ledger-static`: GREEN.
- `ledger-postgres`: GREEN against PostgreSQL 17.
- `lifecycle-static`: GREEN for ACTIVE reservation, DONE consumption, undo-DONE reservation restoration, repeated DONE→undo→DONE idempotency, cancellation release, canonical RETURNED/no-restock integration, online-order delegation, sync round-trip/materialization, weighted-average/recipe costing, and IndexedDB balance projection.
- Plan 4 typecheck: GREEN.
- Full migration regression: GREEN.
- Full unfiltered `npm test`: GREEN.
- Root TUX quality on the same code state passed formatting, lint, unit/integration tests, Admin/WhatsApp security gates, typecheck, and production builds through the migration stage.

Task 2 Ruling: the inventory balance contract must be implemented by every Operations persistence adapter that satisfies `InventoryRepository`; SQLite and IndexedDB both project on-hand/reserved/available from immutable movement history. Cost if wrong: browser Operations could compile around a structurally missing method or diverge from desktop stock authority.


### Plan 4 Task 3 rulings — inventory UI command boundaries

- Ruling: Task 3's `Receive` action means receiving an already-sent inter-shop transfer through `receive_stock_transfer_v1`. Supplier / purchase-order receiving remains exclusively Task 5. Cost if wrong: purchase receipts could gain a second UI/API mutation path before the purchasing transaction and cost-history authority exists.


### Task 3: complete

Evidence at exact code head `61c8152f02be2c18c53d6a5a2bf3cf045323f68b`:
- Plan 4 workflow run `35424323905`: 5/5 GREEN (`ledger-static`, `ledger-postgres`, `lifecycle-static`, `task3-ui`, `task1-regression`).
- `task3-ui`: formatting, Inventory unit/source UI, and rendered `e2e/admin-inventory.spec.ts` GREEN.
- Root `TUX V2 CI` run `35424323935`: all jobs GREEN, including `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`.
- Root `quality` passed format, lint, full unit/integration, security, typecheck, production builds, migration-chain smoke, Edge typecheck, and rendered browser E2E.
- The pre-fix rendered browser regression was traced to `seedBrowserFallback()` creating recipe-tracked inventory items with no opening inventory movements. The fixture now seeds explicit `BULK_STOCK_RECEIVED` movements; production zero-stock enforcement remains unchanged and canonical with PostgreSQL reservation authority.

Task 3 Ruling: Admin inventory writes remain ledger commands only. The browser does not write stock projections directly, emergency negative override remains OWNER-only, and `Receive transfer` is the inter-shop transfer receive action rather than supplier/PO receiving.


### Task 4: complete

Evidence at exact branch head `02a954768cb72e9d6e24a1939b30812ea72838f7`:
- Plan 4 workflow run `35425790580`: all jobs GREEN, including `task4-intelligence`, lifecycle/typecheck, PostgreSQL compatibility, and full unfiltered migration + unit/integration regression.
- Root TUX V2 CI run `35425790584`: every job GREEN, including Required quality gate.
- Root quality job: format, lint, full tests, security gates, typecheck, production builds, migration-chain smoke, Edge Function checks, and rendered browser E2E all GREEN.
- Admin job: security boundary, typecheck, production build, and rendered Admin E2E GREEN.
- Task 4 behavior covers reorder suggestions with minimum/order-multiple rounding, negative available stock, replenishment metadata, actual-vs-theoretical variance, food-cost margin alerts, and inventory intelligence UI.

Task 4 Ruling: `incomingMicros` intentionally remains zero until Task 5 introduces canonical open-PO line quantities. Task 5 must replace this placeholder with open purchase-order remainder without changing on-hand stock before receiving. Replenishment suggestions remain recommendations only and never auto-create or transmit supplier orders.


### Task 5: complete

Evidence at exact code head `caa37bba117f2bce567e5dd89f992613201e83db`:
- Plan 4 workflow run `35431388442`: 8/8 GREEN (`ledger-static`, `ledger-postgres`, `lifecycle-static`, `task3-ui`, `task4-intelligence`, `task5-purchasing`, `task5-postgres`, and `task1-regression`).
- Task 5 service, open-PO incoming intelligence, migration invariant, and rendered Admin purchasing E2E are GREEN.
- Task 5 PostgreSQL behavior is GREEN for partial receiving, immutable purchase-receipt movements, weighted-average cost update, supplier price history, audit creation, idempotent sequential replay, completion of the remaining PO quantity, and purchase return posting.
- Root TUX V2 CI run `35431388443`: every job GREEN, including `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`.
- Root `quality` passed format, lint, full unit/integration tests, security gates, typecheck, production builds, provisioning/migration smoke, function-auth contract, Edge typecheck, and rendered browser E2E.
- Root `admin` passed the Admin security boundary, typecheck, production build, and rendered Admin E2E including the purchasing flow.

The final Task 5 rendered failure was diagnosed from the permanent Admin Playwright trace rather than by changing product behavior speculatively. The purchasing test had first been accidentally registered as an Operations `*.e2e.ts` test, which ran against the Operations Vite server. After moving it into the Admin Playwright suite, the real browser defect became visible: the page crashed after editing a keyed receive/return cost field with `Cannot read properties of null (reading 'value')`. The keyed React handlers were reading `event.currentTarget.value` from inside functional state updaters; the fix captures the input value synchronously before scheduling the updater. The corrected rendered receive/partial-receive/return flow is now GREEN in both the Plan 4 gate and the permanent Admin gate.

Task 5 Ruling: supplier/PO receiving is authoritative only through the trusted Admin BFF and service-role-only transactional RPCs. Receiving posts inventory/cost/PO/price-history/audit state together; purchase returns post compensating negative inventory movements and return history; open-PO remainder contributes only to incoming intelligence and never to on-hand stock before receipt. Purchasing remains within the approved Plan 4 Task 5 scope; broader ERP-like supplier balances/payment status/attachments remain outside this task.

### Plan 4 implementation completion checkpoint — 2026-09-19

Tasks 1–5 are implementation-complete on PR #92. The exact pre-ledger code head is `caa37bba117f2bce567e5dd89f992613201e83db`, with dedicated Plan 4 run `35431388442` and root CI run `35431388443` fully GREEN.

Production promotion remains deliberately separate:
- Canonical Supabase project `awpdcsayuwbsruwvaosg` remains synchronized only through Plan 3 migration `20260918175515 admin_plan3_review_round13_hardening`; Plan 4 migrations `20260910130000`, `20260910140000`, and `20260910150000` have not been applied to production.
- Admin Vercel production remains deployment `dpl_CZfC9PzpWi2PzdKadfLkGyGc5uuA` from `main` commit `b1ddf033c0401286af5f2878d9130d339f99aac8`; no Plan 4 production deployment was performed.
- PR #92 remains draft until the explicit production-promotion/review checkpoint. This ledger mutation changes the PR head, so exact-head CI must be re-verified before any ready-for-review, merge, Supabase migration, or Admin production deployment action.


## Plan 4 final review hardening closeout — 2026-09-20

After Tasks 1–5 reached implementation completion, fresh PR #92 Codex review rounds identified material whole-branch concurrency, convergence, idempotency, reporting, and valuation gaps. Each accepted finding was handled with RED→GREEN evidence before implementation and then re-run through the permanent Plan 4 and root gates.

The final review-hardening pass closed these six findings:

- Canonical multi-device reservation rejection is now surfaced and reconciled locally instead of retrying forever. The canonical ledger rejects the losing reservation under the per-item advisory lock; `operations-sync` maps `TUX_INVENTORY_INSUFFICIENT_STOCK` to permanent HTTP 422; `OutboxSyncService` transactionally quarantines the rejected `ORDER_PLACED` stream, appends local `ORDER_RESERVATION_RELEASE` movements, cancels the still-ACTIVE local order with an explicit sync-conflict audit record, and quarantines dependent lifecycle events.
- Admin mutation command IDs now survive reload/revisit recovery. Stable normalized intent keys are persisted in browser local storage and recovered by a new hook/page lifetime; an authoritative response clears the durable entry. Storage failure degrades to the existing in-memory retention rather than weakening the server idempotency contract.
- Inventory-intelligence movement paging no longer assumes the requested 10,000-row limit equals the effective PostgREST row cap. The reader advances by the actual returned row count and continues until an empty page; the regression uses 1,250 rows behind an effective 1,000-row cap.
- Order-status reads for actual-vs-theoretical reporting are bounded to 100 IDs per request and paginated within each batch, avoiding unbounded `in.(...)` URLs and capped-response truncation.
- Canonical `ORDER_CONSUMPTION` cost is bound at PostgreSQL ingestion under the per-item inventory lock. A stale device-supplied cost can no longer become immutable historical COGS; replay preserves the already-stored canonical snapshot. The PostgreSQL regression sends stale cost 111 against canonical cost 777 and verifies 777 is stored.
- Replenishment-policy updates use an observed-version compare-and-swap predicate. A concurrent writer that advances the row version causes the guarded PATCH to affect zero rows and returns `inventory_replenishment_conflict` instead of silently overwriting another Admin session.

Additional review hardening completed before this final pass includes canonical Admin→Operations inventory convergence, authoritative server-side balances, stable stocktake boundaries, purchase-unit conversion snapshots, weighted purchase-return revaluation with explicit purchase-price variance, SQLite convergence without unsynchronized order/day/worker FK dependencies, and service-role/JWT deployment registration for the Operations inventory feed.

Exact pre-ledger review-hardened code head `3f235e62e4768f361859d2f8bc88089327a372cc` passed the permanent gates:

- `Admin Plan 4 Inventory Purchasing TDD` run `35517992164` — 14/14 jobs SUCCESS, including all seven dedicated final-review gates, Task 3/4/5 UI/service gates, both PostgreSQL behavior jobs, lifecycle/typecheck, and full migration + unit/integration regression.
- `TUX V2 CI` run `35517992152` — SUCCESS, including `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`. Root quality passed format, lint, full unit/integration tests, Admin/WhatsApp security and architecture, typecheck, production builds, provisioning safety, migration-chain smoke, Supabase function-auth contract, Edge Function typecheck, and rendered browser E2E.
- All other permanent Admin workflows attached to the exact code head were SUCCESS.
- The six latest Codex review threads were answered with exact-head RED→GREEN evidence and resolved after the green gate result.

Production promotion remains a distinct guarded checkpoint. This review hardening does not authorize a Supabase migration, Vercel production deployment, ready-for-review transition, or merge.

This ledger commit changes the PR head. Therefore PR #92 must not move to production promotion until the ledger-inclusive exact head passes the permanent workflow set again and a fresh Codex review of that exact final head produces no valid unresolved P0/P1/P2 finding. Any valid new finding reopens TDD.


## Plan 4 final review follow-up — principal-scoped durable command IDs — 2026-09-20

During the final exact-head review window after the prior ledger closeout, an additional targeted integrity audit found that durable Admin mutation command IDs were persisted by shop + normalized intent but not by authenticated principal. If Admin A experienced an ambiguous committed response, logged out, and Admin B later performed the same intent from the same browser, B could reuse A's retained command ID. Because canonical inventory and purchasing replay checks are scoped primarily by shop + command ID, B could receive A's idempotent replay instead of executing B's distinct authorized intent, with incorrect actor/audit semantics.

TDD evidence:
- RED head `0767ed1599d62db204aeab0d441ca11fcb3db569` added a regression requiring identical pending intent to receive distinct durable IDs for distinct employees while preserving same-employee reload recovery. The unimplemented namespace API caused the Admin typecheck to fail before the fix, proving the test was RED.
- The fix makes `createRetainedCommandIds` require a non-empty namespace and includes it in both in-memory and durable retained keys. Inventory and Purchasing hooks bind that namespace to the authenticated `businessId:employeeId`, recreate the helper when the principal changes, and reject unauthenticated mutation attempts before creating a pending ID.
- Same-principal reload/revisit continues to reuse an ambiguous pending command; a different authenticated principal cannot inherit it.

Exact pre-ledger fixed code head `4ad0b285a6e00da22e45591208b1a845fdd718bb` passed:
- `Admin Plan 4 Inventory Purchasing TDD` run `35519618544` — 14/14 jobs SUCCESS, including full unit/migration regression.
- `TUX V2 CI` run `35519618573` — SUCCESS, including format, lint, full unit/integration tests, Admin/WhatsApp security, typecheck, production builds, migration-chain smoke, Edge Function checks, rendered browser E2E, all application jobs, and `Required quality gate`.
- All other permanent Admin workflows attached to this exact head were SUCCESS.

This ledger mutation changes the PR head again. Final Plan 4 review closure therefore still requires the ledger-inclusive exact head to pass the permanent workflow set and receive a fresh Codex review with no valid unresolved P0/P1/P2 finding. Production Supabase/Vercel remain unchanged and are not authorized by this ledger update.


## Plan 4 final review follow-up — transfer identity and PO paging — 2026-09-20

The fresh Codex review of ledger-inclusive head `441d3b2cc5ec36530ab5c8f57728a390903f4057` identified three additional actionable issues, all handled with RED→GREEN evidence:

- Transfer destination identity is now immutable after send. `stock_transfer_lines` persists `destination_inventory_item_id` when `send_stock_transfer_v1` validates the destination item; `receive_stock_transfer_v1` uses that stored UUID directly instead of re-resolving mutable item name/unit after source stock has already left. RED head `cec86e117b493eec5c43efc138a8f52671b06600` failed the new transfer invariant before this column/behavior existed.
- Incoming purchase-order intelligence now pages open POs by actual returned row count and batches their line reads to at most 100 PO IDs per request, with each batch paged until exhaustion. RED root run `35521640087` failed `pages open purchase orders and batches their lines under PostgREST caps` with `purchase order line request too large`.
- The purchasing workspace now keeps the newest 500 historical POs plus every actionable `DRAFT`, `ORDERED`, or `PARTIALLY_RECEIVED` PO from an independently paged query, deduplicates by PO ID, and batches/pages line reads. RED root run `35521640087` failed `keeps actionable purchase orders accessible beyond the 500-row history window` before actionable-order workspace support existed.

Exact pre-ledger fixed head `548b8cdac30d76abbbd2c41476b0c64c3ab6586a` passed:

- `Admin Plan 4 Inventory Purchasing TDD` run `35522323937` — 14/14 jobs SUCCESS, including ledger static/PostgreSQL, Task 4 intelligence, Task 5 purchasing, both PostgreSQL behavior jobs, lifecycle, rendered UI gates, and full migration + unit/integration regression.
- `TUX V2 CI` run `35522323924` — SUCCESS across `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`.
- All three review threads were answered with exact-head evidence and resolved.

The earlier principal-scoped durable-command-ID hardening remains intact on this head. Production promotion remains a separate explicit checkpoint: this work does not authorize ready-for-review, merge, Supabase migration application, or Vercel production deployment.

This ledger mutation changes the PR head again. The ledger-inclusive exact head must pass the permanent workflow set and receive a fresh Codex review with no valid unresolved P0/P1/P2 finding before Plan 4 technical review closure.


## Plan 4 final review follow-up — fulfilled rejection, prepared cancellation, and full-depletion return variance — 2026-09-20

The Codex review of exact head `efd5dd0d771c1b4e1d8bc6b5eb8e0df9e6be25d2` identified three additional actionable lifecycle/accounting issues. Each was reproduced RED before implementation and closed GREEN:

- A canonical reservation rejection that arrives after the local order is already `DONE` no longer falls through the ACTIVE-only compensator silently. The fulfilled order and local consumption remain intact, an `ORDER_SYNC_CONFLICT` audit event records `inventory_reservation_rejected_after_fulfillment` with `manualReconciliationRequired: true`, the rejected outbox stream and dependent lifecycle events are quarantined, and sync health exposes a visible manual-reconciliation detail. RED head `ae9d477edbc40210a860781585b47a2e1ea26c05` failed the fulfilled-rejection outbox and sync-health regressions.
- Cancelling an ACTIVE order with `foodPrepared: true` now converts every active reservation into costed `ORDER_CONSUMPTION` rather than `ORDER_RESERVATION_RELEASE`. Quantity and reserved deltas both consume the reserved quantity, the current weighted unit cost is snapshotted, and cancellation remains `stockRestored: false`. The prior lifecycle test that encoded the superseded release behavior was updated to assert the corrected consumption/balance invariant. RED head `ae9d477e…` failed the prepared-cancellation integration regression.
- A purchase return that exhausts remaining on-hand inventory now removes the entire current inventory value and books the signed difference between receipt return value and current inventory value as purchase-price variance before zeroing weighted cost. This covers both higher-cost and lower-cost full-depletion returns. RED head `ae9d477e…` failed the cheaper full-return PostgreSQL regression with variance `0` instead of `-500`.

Exact pre-ledger fixed head `846d20fd513558ce7387a6028582f81c6d643206` passed:

- `Admin Plan 4 Inventory Purchasing TDD` run `35529090983` — 14/14 jobs SUCCESS, including lifecycle, full regression, final-review return cost, and Task 5 PostgreSQL behavior.
- `TUX V2 CI` run `35529090965` — SUCCESS across `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`.
- All other permanent Admin workflows attached to this exact head were SUCCESS.
- The three review threads were answered with RED→GREEN evidence and resolved.

Production promotion remains a distinct explicit checkpoint. This ledger mutation changes the PR head again, so the ledger-inclusive exact head must pass the permanent workflow set and receive a fresh Codex review with no valid unresolved P0/P1/P2 finding before Plan 4 technical review closure. No merge, Supabase production migration, or Vercel production deployment is authorized by this update.

## Plan 4 final review follow-up — legacy placement capacity, pending transfer reachability, and recipe paging — 2026-09-20

The final Codex review of exact head `904ce81416505fd1af4a8a34f3325a68a8272071` identified three additional actionable issues. Each was captured by a regression before closure and is now fixed:

- Legacy queued `ORDER_PLACED` inventory consumption can no longer bypass canonical stock capacity. The ledger trigger now treats zero-reservation `ORDER_CONSUMPTION` with a negative quantity delta as legacy placement demand, acquires the same per-shop/per-item advisory lock used by reservations, recomputes canonical available stock, and rejects insufficient capacity with `TUX_INVENTORY_INSUFFICIENT_STOCK`. RED head `bf2d4483ccaba7a5f0fd3d918a98bd730cabeaa0` failed Plan-4 `ledger-static` job `106138077818` in run `35533393946` with the expected `canonical capacity fence must serialize legacy zero-reservation ORDER_CONSUMPTION` assertion.
- Incoming `SENT` transfers remain reachable even after they fall outside the newest-100 transfer history window. The Admin inventory workspace now loads the bounded recent history plus an independently paged destination-scoped `SENT` set, deduplicates by transfer ID, pages/batches transfer-line reads, and batches transfer inventory-item reads. The regression also covers multiple actionable pages rather than only the first page.
- Recipe intelligence now pages the complete shop `recipe_lines` set by actual returned row count until exhaustion. The regression places 1,250 recipe rows behind an effective 1,000-row PostgREST cap and verifies the full recipe cost and page offsets, preventing truncated recipe costs from suppressing food-cost margin alerts.

Exact pre-ledger fixed head `b1599025b1cf543f6ce10b4f0498660a7a4021a0` passed:

- `Admin Plan 4 Inventory Purchasing TDD` run `35533800694` — 14/14 jobs SUCCESS, including `ledger-static`, `ledger-postgres`, Task 3 transfer UI/source regression, Task 4 intelligence, Task 5 purchasing, lifecycle/typecheck, both PostgreSQL behavior jobs, and full migration + unit/integration regression.
- `TUX V2 CI` run `35533800647` — SUCCESS across `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`.
- Foundation, Catalog, Catalog Boundary, Plan 2 rounds 15/16/17, and Plan 3 permanent workflows attached to this exact head were SUCCESS.

Production promotion remains a separate explicit checkpoint. No ready-for-review transition, merge, Supabase production migration, or Vercel production deployment is authorized by this review-hardening step.

This ledger plus strengthened transfer regression changes the PR head. The resulting exact head must pass the permanent workflow set again before the three Codex threads are resolved and a fresh final Codex review is requested.

## Plan 4 final review follow-up — reservation lifecycle integrity and large-catalog usability — 2026-09-21

The Codex review of exact head `204178cda4dba10951b414e1f416dd143c31b37d` identified four additional actionable findings. All four were reproduced RED before implementation and closed with targeted hardening:

- Operations sync now validates inventory movements against their event lifecycle semantics rather than accepting any structurally valid movement. `ORDER_PLACED` accepts only positive reservations or the legacy zero-reservation consumption compatibility shape; lifecycle transitions accept only the matching consumption/reversal/release/restock combinations; generic `INVENTORY_MOVEMENT_RECORDED` is restricted to non-order Bulk Stock / legacy Admin-adjustment shapes with zero reservation delta and no order identity. RED head `3e8af2e6e38b910e57f6e67f57f2101a16aee9ef`, Plan-4 run `35535932475`, failed `lifecycle-static` job `106144900734` because a forged `ORDER_RESERVATION_RELEASE` generic event was accepted.
- The canonical ledger now independently fences negative reservation deltas under the per-shop/per-item advisory lock and binds them to that order's existing reserved balance. A release without an order identity, a release larger than the order's remaining reservation, or a repeated over-release raises `TUX_INVENTORY_RESERVATION_UNDERFLOW`. RED head `b5ebf138aa69f9c9af7f278c3862a85025822c93`, Plan-4 run `35537422450`, failed `ledger-postgres` job `106148928610` because the forged underflow release unexpectedly succeeded before the fence.
- Active purchase-unit conversions are unique by inventory item + `lower(btrim(purchase_unit_label))`, and PO conversion lookup uses the same normalized comparison. This removes nondeterministic `Case` / `case` resolution. RED head `3e8af2e6e38b910e57f6e67f57f2101a16aee9ef` failed `final-review-purchase-units` job `106144847572` with `purchase-unit labels must be unique case-insensitively per inventory item`.
- The Admin inventory workspace now pages the complete inventory-item catalog by actual returned row count under PostgREST caps. The same review pass also added cap-safe paging for canonical balance RPC rows and inventory cost-state rows so catalogs above 1,000 items retain complete balance/cost projections.
- Stocktake remains usable above the 500-item command limit. Catalogs of 500 or fewer items keep the direct flow; larger catalogs expose deterministic batches of at most 500 items, and each selected batch receives its own frozen stocktake snapshot. RED head `3e8af2e6e38b910e57f6e67f57f2101a16aee9ef` failed `task3-ui` job `106144900727` because the item loader was unpaged and the bounded stocktake selector did not exist.

The first GREEN implementation was committed in `c718910b3fc2a6e7e2a7b336cd73acb350b7da5d`. Follow-up RED→GREEN hardening added balance/cost paging (`bc903176d9da7aa6c6aaa47853ed092139c5c2f0` → `c7ee7212c25085c0f7f2841117b646f594226201`) and an explicit order-bound reservation-release regression/fence (`4c3d67992dbd808536bd682ab18469fc73f3cf4a` → `5663e846236f0140efcb3ef1e1893d19333c1d9b`). Temporary Prettier diagnostics were removed after reproducing the exact formatting delta.

Exact pre-ledger fixed head `e1b7a74994153f3a5c35a5eeee82bac4db550c74` passed:

- `Admin Plan 4 Inventory Purchasing TDD` run `35541542736` — 14/14 jobs SUCCESS, including purchase-unit, stocktake, lifecycle/sync, canonical ledger PostgreSQL, Task 3 large-catalog UI/E2E, Task 4/5, both purchasing PostgreSQL paths, and full migration + unit/integration regression.
- `TUX V2 CI` run `35541542644` — SUCCESS across `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`. Root quality passed format, lint, unit/integration tests, security/architecture gates, typecheck, production builds, migration-chain smoke, Supabase function-auth contract, Edge Function typecheck, and rendered browser E2E.
- Foundation `35541542742`, Catalog `35541542802`, Catalog Boundary `35541542723`, Plan 2 rounds 15/16/17 `35541542656` / `35541542648` / `35541542643`, and Plan 3 `35541542887` were SUCCESS.

Production promotion remains a separate explicit checkpoint. This ledger update does not authorize ready-for-review, merge, Supabase production migration, or Vercel production deployment. Because this documentation commit changes the PR head, the ledger-inclusive exact head must pass the permanent workflow set again before the four Codex threads are resolved and another exact-head final Codex review is requested.

## Plan 4 final review follow-up — immutable movement identity, terminal rejection reconciliation, and exhaustive workspace paging — 2026-09-21

The Codex review of exact head `35bcf1b23e7c21f21b60fa9147107c19f5171346` identified seven additional actionable integrity and scale findings. All seven were reproduced before closure and fixed without changing the production-promotion boundary:

- Canonical inventory movements are now strictly append-only. `private.enforce_inventory_movement_immutability_v1` rejects every UPDATE of `public.inventory_movements` with `TUX_INVENTORY_MOVEMENT_IMMUTABLE`, so a synced UPSERT cannot reuse a known movement UUID to rewrite an Admin receipt, reservation, or prior movement while bypassing INSERT-time capacity/underflow checks.
- Rejected offline placements now surface manual reconciliation for every locally fulfilled terminal state, not only `DONE`. `DONE`, `RETURNED`, and prepared `CANCELLED` orders emit `ORDER_SYNC_CONFLICT` with `inventory_reservation_rejected_after_fulfillment` and `manualReconciliationRequired: true` instead of silently retaining local fulfillment/consumption after canonical rejection.
- Stocktake entry points now use active inventory items only. Direct counts and every <=500-item batch are built from the active subset; if a shop has no active inventory items, the stock-count action is disabled.
- `post_stocktake_v1` now validates submitted stocktake item IDs as an exact set: duplicate IDs are rejected and two-way `EXCEPT` comparisons prove that no snapshot line is omitted or replaced before any count is posted.
- Inventory intelligence now pages `inventory_replenishment_settings` and active `products` by actual returned row count under PostgREST caps, preserving reorder policies and margin alerts for catalogs above the server row cap.
- The purchasing workspace now pages every active purchasable inventory item so PO creation does not silently omit items beyond the PostgREST cap.

The formatted RED head `b1cbfa4792a9c0d36049753eb7048c0c1e5f805a` (Plan-4 run `35543109211`) failed `final-review-stocktake` job `106164466288` and `ledger-static` job `106164466318` before the exact-set/immutability hardening. Intermediate GREEN commits `99f0da5a1f001d3b84b63c0a26c30707e6ca29af`, `590c8341c112a9b72a3feef17e428fabdf07d313`, and `a6dbc3eb54659c902bacf82fecab9552dee792b6` closed movement immutability, stocktake exact-set/active filtering, terminal placement reconciliation, replenishment/product paging, and purchasable-item paging. Their staged workflow failures were used to keep each remaining regression visible until its corresponding production fix landed.

A focused large-catalog self-audit then found two adjacent readers in the same bounded-PostgREST risk class and closed them with independent RED→GREEN evidence:

- Supplier paging: test-only head `716cfc77334b111c4e0dd074511d0d87f211124b`, Plan-4 run `35545193511`, `task5-purchasing` job `106169789022` failed because a 1,250-supplier workspace returned only 1,000 suppliers. `92e687271914455c7c47f277bdb139817d6393fe` added exhaustive supplier paging by actual returned row count.
- Margin-policy paging: on supplier-fixed head `92e687271914455c7c47f277bdb139817d6393fe`, Plan-4 run `35545277507`, `task5-purchasing` job `106170003074` failed because product `product-1249` fell back to default target/alert thresholds `30/35` instead of configured `20/25`. `3da5b319cd625f7decb5e78b6fb77d66647be37a` added exhaustive `inventory_margin_settings` paging; `49a330ddd8b0776a1437c90d3d7458521af8ec6d` contains the final formatting-normalized regression.

Exact pre-ledger fixed head `49a330ddd8b0776a1437c90d3d7458521af8ec6d` passed:

- `Admin Plan 4 Inventory Purchasing TDD` run `35545425487` — 14/14 jobs SUCCESS, including lifecycle/sync reconciliation, stocktake UI/PostgreSQL integrity, inventory intelligence, purchasing workspace, both PostgreSQL behavior paths, rendered Task 3/5 E2E, and full migration + unit/integration regression.
- `TUX V2 CI` run `35545425514` — SUCCESS across `quality`, `admin`, `menu`, `windows-package`, `edge-security`, `monorepo-architecture`, and `Required quality gate`. The quality lane passed format, lint, unit/integration tests, typecheck, production builds, migration-chain smoke, Edge Function checks, and rendered browser E2E.
- Foundation `35545425523`, Catalog `35545425512`, Catalog Boundary `35545425504`, Plan 2 rounds 15/16/17 `35545425505` / `35545425500` / `35545425503`, and Plan 3 `35545425502` were SUCCESS.

Production promotion remains a separate explicit checkpoint. No ready-for-review transition, merge, Supabase production migration, or Vercel production deployment is authorized by this hardening round. Because this ledger commit changes the PR head, the resulting ledger-inclusive exact head must pass the permanent workflow set before the seven Codex threads are resolved and another final exact-head Codex review is requested.

