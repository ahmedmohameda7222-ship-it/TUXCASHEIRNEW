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
| ORD-001 | Two-panel desktop layout with persistent cart. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-002 | Dynamic categories. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-003 | Direct +/- product quantities. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-004 | No Add to Cart button. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-005 | Optional product image. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-006 | Quick Info description. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-007 | Extras standalone + modifiers. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-008 | Required combo beverage per combo unit. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-009 | Item note and order note separate. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-010 | Delivery-only customer fields. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-011 | Delivery requires phone/name/zone/address. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-012 | Egyptian phone normalization/autofill. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-013 | Zone auto fee + worker can manually edit fee. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-014 | Fixed discount applies to items subtotal only. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-015 | Exact money semantics. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-016 | Payment method has stable logic type separate from label. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-017 | Payment selection resets every successful order. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-018 | Order type resets to first active configured type after success. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-019 | Current Operator persists. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-020 | Split payment max 2; second amount is remainder. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-021 | Cash Received / Change behavior. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-022 | Smart tender suggestions. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-023 | Validate all before mutations. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-024 | Durable local commit before print. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-025 | Local failure blocks checkout and keeps cart. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-026 | Offline local save counts as success and queues cloud. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-027 | Idempotent duplicate prevention. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-028 | Business Day, not calendar date, owns display order numbering. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-029 | Global immutable order ID never resets. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-030 | Draft never silently disappears at End Day. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-031 | Calculated inventory shortage alone does not block checkout. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-032 | Sold Out blocks sellability. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
| ORD-033 | Placed orders immutable. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |
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
