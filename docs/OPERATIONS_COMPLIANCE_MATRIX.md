# TUX V2 Operations Compliance Matrix

**Canonical source:** `docs/TUX_V2_Operations_Master_Approved_Plan.md`  
**Phase 0 baseline:** 2026-08-17  
**Status vocabulary:** `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_NOT_VALIDATED`, `PASS`, `BLOCKED`

This matrix starts from every atomic `[APPROVED]` decision in Appendix B of the canonical Master Plan. Detailed section-level implementation notes and evidence must be added before any row can become `PASS`. Appendix B is a quick register and does not replace the detailed specification; phase work must read the detailed source section before implementation.

| ID | Requirement | Area | Implementation location | Database / migration | Tests | Status | Evidence / notes |
|---|---|---|---|---|---|---|---|
| OPS-001 | Separate TUX Operations and TUX Admin applications. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-002 | Admin does not appear inside Operations. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-003 | Final Operations nav: Orders / Orders Board / Expenses / Bulk Stock. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-004 | Inventory Usage removed from Operations. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-005 | Reconcile removed as standalone tab and moved into End Day. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-006 | Bulk Inventory worker-facing name becomes Bulk Stock. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| OPS-007 | End Day lives in operator/profile menu. | Operations shell | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-001 | No active day screen has TUX logo, `TUX Operations`, `No active Business Day`, `Enter PIN to Start Day`. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-002 | PIN starts new Business Day only when none is active. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-003 | Current Operator becomes the worker who authenticated. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-004 | Greeting transition before Orders. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-005 | Approved greeting copy: `Good afternoon, {name}. Glad you made it in safely. Have a great shift.` with time-aware salutation. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| START-006 | Greeting duration about 1–1.5 seconds, then Orders. | Start / operator | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-001 | Two-panel desktop layout with persistent cart. | Orders | `apps/operations/src/app/OrdersWorkspace.tsx`; `OrdersCart.tsx`; `styles/orders.css` | — | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Desktop persistent cart and separate mobile cart sheet implemented; no manual rendered interaction QA recorded yet. |
| ORD-002 | Dynamic categories. | Orders | `apps/operations/src/app/OrdersWorkspace.tsx` | Local configuration snapshot | Workspace configuration loading; production build | IMPLEMENTED_NOT_VALIDATED | Active categories come from configuration, are sort-ordered, and no `All` category is introduced; manual interaction QA still pending. |
| ORD-003 | Direct +/- product quantities. | Orders | `packages/domain/src/draftOperations.ts`; `apps/operations/src/app/OrdersWorkspace.tsx` | Durable `OrderDraftStore` | `packages/domain/src/draftOperations.test.ts` | IMPLEMENTED_NOT_VALIDATED | Domain add/decrement semantics and deterministic most-recent removal are tested; rendered control interaction has no E2E evidence yet. |
| ORD-004 | No Add to Cart button. | Orders | `apps/operations/src/app/OrdersWorkspace.tsx` | — | Production build | IMPLEMENTED_NOT_VALIDATED | Product cards expose direct +/- only; manual rendered audit still pending. |
| ORD-005 | Optional product image. | Orders | `apps/operations/src/app/OrdersWorkspace.tsx`; `styles/orders.css` | Configuration `imageKey` | Production build | IMPLEMENTED_NOT_VALIDATED | Optional contain image plus deterministic fallback implemented; visual QA still pending. |
| ORD-006 | Quick Info description. | Orders | `apps/operations/src/app/OrdersWorkspace.tsx` | Configuration `description` | Production build | IMPLEMENTED_NOT_VALIDATED | Non-control card area opens Quick Info using configured description; interaction QA still pending. |
| ORD-007 | Extras standalone + modifiers. | Orders | `packages/domain/src/draftOperations.ts`; `apps/operations/src/app/ProductCustomizer.tsx` | Configuration products/modifiers/links | `packages/domain/src/draftOperations.test.ts` | IMPLEMENTED_NOT_VALIDATED | Standalone extras remain normal configured products; product modifiers enforce configured eligibility/max quantity. Customizer interaction QA still pending. |
| ORD-008 | Required combo beverage per combo unit. | Orders | `packages/domain/src/draftOperations.ts`; `ProductCustomizer.tsx`; `orderValidation.ts` | Configuration combo beverage options | `packages/domain/src/draftOperations.test.ts` | PASS | Domain rejects missing/unavailable/disallowed combo beverages and requires one beverage selection per combo unit. |
| ORD-009 | Item note and order note separate. | Orders | `packages/domain/src/orderDraft.ts`; `ProductCustomizer.tsx`; `OrdersCart.tsx` | Immutable order snapshot | Receipt rendering test; production build | IMPLEMENTED_NOT_VALIDATED | Separate typed fields and separate UI editors exist; full renderer interaction path has no E2E evidence yet. |
| ORD-010 | Delivery-only customer fields. | Orders | `apps/operations/src/app/OrdersCart.tsx` | Delivery fulfillment snapshot | Production build | IMPLEMENTED_NOT_VALIDATED | Name/phone/zone/address/fee section renders only for configured Delivery behavior; manual interaction QA still pending. |
| ORD-011 | Delivery requires phone/name/zone/address. | Orders | `packages/domain/src/orderValidation.ts`; `OrdersCart.tsx` | Immutable Delivery snapshot | Strict typecheck; successful Delivery integration path | IMPLEMENTED_NOT_VALIDATED | Validation rules are implemented and source-local errors are wired, but missing-field interaction cases do not yet have dedicated automated UI coverage. |
| ORD-012 | Egyptian phone normalization/autofill. | Orders | `packages/domain/src/phone.ts`; `OrdersWorkspace.tsx`; `OperationsOrdersService` | Customer contacts repository | `packages/domain/src/phone.test.ts`; Delivery customer integration test | IMPLEMENTED_NOT_VALIDATED | Normalization and successful-contact learning are tested; renderer autofill interaction is implemented but has no E2E evidence yet. |
| ORD-013 | Zone auto fee + worker can manually edit fee. | Orders | `packages/domain/src/draftOperations.ts`; `OrdersCart.tsx` | Delivery configured/final fee snapshots | `draftOperations.test.ts`; Delivery checkout integration test | PASS | Zone selection snapshots configured fee, initializes final fee, and checkout preserves a worker-edited final fee separately. |
| ORD-014 | Fixed discount applies to items subtotal only. | Orders | `packages/domain/src/pricing.ts`; `OrdersCart.tsx` | Immutable order pricing snapshot | `packages/domain/src/pricing.test.ts` | PASS | Exact pricing helper validates discount against item subtotal and adds Delivery fee outside the discounted item subtotal. |
| ORD-015 | Exact money semantics. | Orders | `packages/domain/src/money.ts`; `payment.ts`; `pricing.ts`; `MoneyInput.tsx` | Integer minor units | Money/pricing/payment tests | PASS | Orders calculations and editable money parsing use branded integer minor units; no floating-point accounting path is used. |
| ORD-016 | Payment method has stable logic type separate from label. | Orders | `packages/domain/src/catalog.ts`; `payment.ts` | Payment-method configuration snapshot | `packages/domain/src/payment.test.ts` | PASS | Cash behavior is driven by stable `logicType`, including a test with a non-`Cash` display label. |
| ORD-017 | Payment selection resets every successful order. | Orders | `packages/application/src/orders.ts` | Durable post-checkout draft | SQLite Orders integration test | PASS | Successful checkout rotates the draft and resets payment to `{ mode: 'NONE' }`. |
| ORD-018 | Order type resets to first active configured type after success. | Orders | `packages/application/src/orders.ts` | Durable post-checkout draft | SQLite Orders integration test | PASS | Successful checkout creates the next draft with the first active configured order type. |
| ORD-019 | Current Operator persists. | Orders | `OperationsOrdersService`; existing session service/shell | Worker session + immutable order operator snapshot | SQLite Orders/session integration tests | PASS | Checkout snapshots the authenticated operator and does not terminate/switch the current worker session. |
| ORD-020 | Split payment max 2; second amount is remainder. | Orders | `packages/domain/src/payment.ts`; `OrdersCart.tsx` | Immutable payment snapshots | `packages/domain/src/payment.test.ts` | PASS | Split model contains exactly A/B methods and calculates B as exact total minus Amount A; duplicate methods are rejected. |
| ORD-021 | Cash Received / Change behavior. | Orders | `packages/domain/src/payment.ts`; `OrdersCart.tsx` | Immutable payment snapshots | Payment tests; SQLite Cash checkout integration test | PASS | Cash Received is required and cannot be below allocation; Change is calculated exactly and persisted in the order snapshot. |
| ORD-022 | Smart tender suggestions. | Orders | `packages/domain/src/tender.ts`; `OrdersCart.tsx` | — | `packages/domain/src/tender.test.ts` | PASS | Domain helper produces exact common-Egyptian-note tender suggestions and renderer consumes the helper directly. |
| ORD-023 | Validate all before mutations. | Orders | `packages/domain/src/orderValidation.ts`; `packages/application/src/orders.ts` | Single local transaction starts only after validation | SQLite Orders validation-failure integration test | PASS | Invalid checkout returns `VALIDATION_ERROR`; orders, inventory, audit, outbox, numbering, and durable draft state remain mutation-free. |
| ORD-024 | Durable local commit before print. | Orders | `OperationsOrdersService`; `@tux/printing`; Electron/browser printer adapters | Local order transaction before printer port | SQLite print integration tests; receipt tests | PASS | Fresh order is committed before printer invocation; print failure returns a post-commit warning and cannot roll back the saved order. |
| ORD-025 | Local failure blocks checkout and keeps cart. | Orders | `OperationsOrdersService`; durable draft stores | SQLite transaction + draft store | Injected inventory-failure integration test | PASS | Injected local persistence failure rolls back order/number/inventory/audit/outbox and preserves the checkout-intent draft. |
| ORD-026 | Offline local save counts as success and queues cloud. | Orders | `OperationsOrdersService` | Local `ORDER_PLACED` durable outbox event | SQLite checkout integration test | PASS | Checkout has no remote dependency; local commit succeeds with remote unconfigured and writes `ORDER_PLACED` to durable outbox in the same transaction. |
| ORD-027 | Idempotent duplicate prevention. | Orders | `OperationsOrdersService`; checkout intent key | Unique idempotency lookup/constraints | SQLite stale-intent replay integration test | PASS | Replayed committed intent returns the existing Order and does not duplicate order, inventory, numbering, audit/outbox, or automatic print effects. |
| ORD-028 | Business Day, not calendar date, owns display order numbering. | Orders | Business Day domain + `OperationsOrdersService` | Business-Day scoped counter and unique order constraint | Business Day tests; SQLite Orders integration test | PASS | Checkout allocates from the open Business Day counter; no calendar-date reset logic participates. |
| ORD-029 | Global immutable order ID never resets. | Orders | Branded `OrderId`; `OperationsOrdersService` | UUID primary order identity | SQLite Orders/idempotency integration tests | PASS | Each placed order uses UUID identity independent of Business-Day display numbering; replay returns the same immutable Order ID. |
| ORD-030 | Draft never silently disappears at End Day. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-031 | Calculated inventory shortage alone does not block checkout. | Orders | `OperationsOrdersService` inventory movement append | Append-only inventory ledger | SQLite successful checkout integration test | PASS | Checkout does not require a positive calculated balance; test fixture successfully places an order without preloading positive stock balance and appends exact consumption. |
| ORD-032 | Sold Out blocks sellability. | Orders | `packages/domain/src/draftOperations.ts`; `OrdersWorkspace.tsx` | Configuration `soldOut` flag | `packages/domain/src/draftOperations.test.ts` | PASS | Domain rejects adding a Sold Out product and renderer disables its add control. |
| ORD-033 | Placed orders immutable. | Orders | `packages/domain/src/models.ts`; persistence `OrderRepository`; receipt/reprint path | Order repository exposes `insert`, not general update | SQLite Orders/print integration tests | PASS | Checkout persists an immutable `OrderSnapshot`; reprint reads by ID and creates no order mutation. Later corrections must use explicit audited transitions. |
| ORD-034 | Cancel asks whether food was prepared. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-035 | Return means Delivery Failed only. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-036 | Returned Delivery: no stock restore, zero recognized revenue, zero collected payment. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-037 | Delivery Failed Expenses event has amount null. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-001 | Lifecycle ACTIVE → DONE, with CANCELLED and RETURNED terminal exceptions. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-002 | No multi-stage kitchen workflow. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-003 | No general Reopen. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-004 | Active oldest first. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-005 | Done newest first. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-006 | Waiting age displayed. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-007 | Active rich order-card grid. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-008 | Done/Cancelled/Returned compact rows. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-009 | Current Business Day only. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-010 | Delivery Done when order leaves location. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-011 | Short Mark Done Undo about 5–8 seconds. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-012 | Search Order # only across current Business Day statuses. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-013 | Details drawer/sheet. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-014 | Cancel ACTIVE only. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-015 | DONE Delivery may become RETURNED. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-016 | Active Delivery card shows Customer Name + Zone. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-017 | No On-site orders tab. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-018 | No current new-order sound. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BOARD-019 | Keep source/channel future-ready without unused UI. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-001 | Current Business Day operational ledger. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-002 | Manual Expense = Description + Amount + Paid From + optional Note. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-003 | Paid From = Cash / Other. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-004 | Cash expense reduces Expected Cash. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-005 | Other expense does not change drawer Expected Cash. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-006 | Manual current-day expense editable/deletable. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-007 | Delivery Failed record locked and non-financial. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-008 | Show Total Expenses for current Business Day. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-009 | Newest-first compact list. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-010 | End Day clears Expenses from operational view and archives them to Reports/history. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| EXP-011 | No destructive database deletion. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-001 | Bulk Stock remains in Operations. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-002 | Purpose is manual tracking of whole bulk units the POS cannot infer. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-003 | Worker action is `Finished 1` when whole unit actually finishes. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-004 | Do not decrement merely when opening a unit. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-005 | Worker can `Add Stock` when physical stock arrives. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-006 | Add Stock is not automatically a financial Purchase. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-007 | Stock uses movement ledger, not direct overwrite. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-008 | Worker cannot create/rename/delete/configure/reset items. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-009 | Bulk Stock balance persists across Business Days. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-010 | No End Day reset. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-011 | Short Undo creates compensating movement. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| BULK-012 | Later correction belongs in Admin Stock Adjustment. | Bulk Stock | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-001 | Reconciliation mandatory inside End Day. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-002 | End Day launched from profile/operator menu. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-003 | Current real payment methods: Cash + Instapay. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-004 | No Card reconciliation UI now. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-005 | No Opening Cash/Float. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-006 | Blind actual entry before Expected values are revealed. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-007 | Cash expected = eligible Cash collected − Cash-paid Expenses. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-008 | Returned Delivery excluded from expected payment collection. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-009 | Variance does not block closing. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-010 | Non-zero variance requires reason. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-011 | Variance remains its own reconciliation fact, not automatic Expense/Revenue. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-012 | ACTIVE orders hard-block End Day. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-013 | Draft requires Return to Order or Discard Draft & Continue. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-014 | Final Closing Summary before final close. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-015 | No Profit/Margin/COGS in worker closing summary. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-016 | Closed Business Day cannot be reopened from Operations. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-017 | End Day works offline. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-018 | Cloud failure does not block close. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-019 | Local durable save failure blocks close. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-020 | Close is idempotent. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-021 | No automatic End Day PDF. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-022 | No automatic End Day print. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-023 | Reports/export/print move to Admin Reports. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-024 | After close, Current Operator session ends. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-025 | App returns to No Active Business Day screen. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-026 | No automatic next Business Day. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-027 | Next Business Day order display number starts at #1. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
| END-028 | Bulk Stock carries forward unchanged except for recorded movements. | End Day / Reconciliation | — | — | — | NOT_STARTED | Appendix B approved decision register |
