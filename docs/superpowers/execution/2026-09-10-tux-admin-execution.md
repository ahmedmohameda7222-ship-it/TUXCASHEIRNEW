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

Exact-head CI history used during planning included successful runs at `74d0adaf...`, `ae080500...`, and final `d6c422a0...`; final exact-head Actions run `34525750839` passed Menu rendered E2E, root rendered browser E2E, migration-chain smoke, edge/security checks, Windows packaging, typecheck/builds, and `Required quality gate`.

The final Codex review request for `d6c422a0...` had entered processing when the latest user instruction explicitly required implementation to begin immediately. PR #60 was merged only after final exact-head CI was fully green and every then-known Codex review thread was resolved. The in-progress Codex result remains review evidence to monitor; any subsequent concrete valid finding must be folded into the applicable implementation gate before the affected feature is accepted.

## Local execution limitation

Direct local GitHub clone was unavailable because the execution container could not resolve `github.com`. GitHub connector writes are therefore the repository mutation path and GitHub Actions is the executable CI authority for RED/GREEN evidence when a local checkout cannot be used. Do not claim tests passed without Actions or another executable result.

## Repository rulings established before Plan 1

1. Root `tsconfig.api.json` currently includes only root `api/**/*.ts` and `server/**/*.ts`; Admin API/server TypeScript must be included explicitly, either by extending the root API project or by adding an Admin API/server tsconfig invoked from root `typecheck`.
2. Root npm workspaces already include `packages/*`; `packages/admin-contracts` is a normal workspace and must follow existing source-export package conventions.
3. Existing canonical `public.shops`, `shop_memberships`, `workers`, `business_days`, devices, orders/payments, inventory ledger, Menu, and Operations contracts must be extended additively; they are not replaced by Admin models.
4. Thin route files should follow the repository's existing `IncomingMessage`/`ServerResponse` gateway convention, with shared same-origin/body/response helpers rather than introducing an unnecessary framework-specific request abstraction.
5. Foundation Task 1 must define the stable permission union immediately; `AdminPermission = string` from the older numbered-plan example is superseded.

## Codex planning findings and corrective rulings

All findings below were classified VALID and fixed in planning before the affected implementation gate, unless noted as later exact-head review evidence.

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

## Plan 1 active checklist

- [ ] Task 1 — create `@tux/admin-contracts` with stable roles, stable permission union, session/shop/command contracts.
- [ ] Task 2 — add business identity, Admin auth/permission/session schema with deny-by-default RLS/grants and trusted RPCs.
- [ ] Task 3 — implement secure PIN-only Admin BFF/session, eight-failures/15-minute throttle, generic `/api/admin/reauth`, explicit API/server typecheck inclusion.
- [ ] Hardening insertion immediately after Task 3 — one-time service-role-only OWNER bootstrap with no default/source-stored production PIN.
- [ ] Task 4 — scaffold `apps/admin` PWA workspace using existing Menu-compatible dependency versions.
- [ ] Task 5 — session bootstrap, permission-aware routes, and shop context.
- [ ] Task 6 — adaptive mobile-first Admin shell.
- [ ] Task 7 — Foundation security/regression CI gate.

## TDD evidence log

Plan 1 starts with tests/contracts before implementation. Because the current execution environment has no working repository clone, RED evidence will be established by committing failing tests to the Plan 1 branch and observing the corresponding GitHub Actions failure. GREEN implementation will then be committed and the same focused checks rerun through Actions. No task is marked complete from static inspection alone.
