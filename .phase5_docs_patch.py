from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Expected documentation snippet not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


matrix = 'docs/OPERATIONS_COMPLIANCE_MATRIX.md'
rows = {
"| ORD-033 | Placed orders immutable. | Orders | `packages/domain/src/models.ts`; persistence `OrderRepository`; receipt/reprint path | Order repository exposes `insert`, not general update | SQLite Orders/print integration tests | PASS | Checkout persists an immutable `OrderSnapshot`; reprint reads by ID and creates no order mutation. Later corrections must use explicit audited transitions. |":
"| ORD-033 | Placed order commercial/payment facts remain immutable. | Orders | `packages/domain/src/models.ts`; `OrderRepository.updateOperationalState`; receipt/reprint path | Operational update preserves stored snapshot and changes only status/lifecycle metadata | SQLite Orders/print + Orders Board integration tests | PASS | Checkout persists the historical `OrderSnapshot`. Phase 5 corrections use a narrow audited operational-state update that copies only status/lifecycle onto the stored snapshot; totals, payments, items, operator, fulfillment, numbering and receipt facts remain unchanged. |",
"| ORD-034 | Cancel asks whether food was prepared. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| ORD-034 | Cancel asks whether food was prepared. | Orders | `apps/operations/src/app/OrdersBoardWorkspace.tsx`; `OperationsOrdersBoardService` | Cancellation lifecycle snapshot + compensating inventory ledger | Orders Board SQLite integration tests | IMPLEMENTED_NOT_VALIDATED | Renderer presents the required Yes/No prepared decision and reason before cancellation; service persists the decision and tests prove the resulting restock behavior. Renderer interaction still lacks E2E evidence. |",
"| ORD-035 | Return means Delivery Failed only. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| ORD-035 | Return means Delivery Failed only. | Orders | `packages/domain/src/orderLifecycle.ts`; `OperationsOrdersBoardService` | RETURNED lifecycle metadata | `orderLifecycle.test.ts`; Orders Board SQLite integration tests | PASS | Domain/service permit RETURNED only from a DONE Delivery order and reject DONE non-Delivery or other invalid transitions. |",
"| ORD-036 | Returned Delivery: no stock restore, zero recognized revenue, zero collected payment. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| ORD-036 | Returned Delivery: no stock restore, zero recognized revenue, zero collected payment. | Orders | `OperationsOrdersBoardService.returnDelivery` | Original order snapshot + audit/outbox return facts | Orders Board SQLite integration test | PASS | Return leaves original inventory consumption and historical order/payment snapshot untouched; audit/outbox record zero recognized revenue/collection, reconciliation exclusion, and `inventoryRestored: false`. |",
"| ORD-037 | Delivery Failed Expenses event has amount null. | Orders | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| ORD-037 | Delivery Failed Expenses event has amount null. | Orders | `OperationsOrdersBoardService.returnDelivery` | `Expense(kind=DELIVERY_FAILED, amountMinor=null, paidFrom=null)` | Orders Board SQLite integration test | PASS | Delivery Failed atomically inserts the linked non-financial expense with null amount/payer; null is not converted to zero. |",
"| BOARD-001 | Lifecycle ACTIVE → DONE, with CANCELLED and RETURNED terminal exceptions. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-001 | Lifecycle ACTIVE → DONE, with CANCELLED and RETURNED terminal exceptions. | Orders Board | `packages/domain/src/orderLifecycle.ts`; `OperationsOrdersBoardService` | Status + lifecycle revision metadata | Domain lifecycle + Orders Board SQLite integration tests | PASS | Approved transitions are explicit and tested: ACTIVE→DONE, ACTIVE→CANCELLED, DONE Delivery→RETURNED; invalid terminal transitions are rejected without side effects. |",
"| BOARD-002 | No multi-stage kitchen workflow. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-002 | No multi-stage kitchen workflow. | Orders Board | `orderLifecycle.ts`; `OrdersBoardWorkspace.tsx` | Only approved order statuses | Strict typecheck; lifecycle tests | PASS | Domain/application expose no preparing/ready/dispatch kitchen stages; renderer uses only Active, Done, Cancelled and Returned. |",
"| BOARD-003 | No general Reopen. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-003 | No general Reopen. | Orders Board | `canUndoOrderDone`; `undoOrderDone`; `OperationsOrdersBoardService.undoDone` | Time-bounded lifecycle revision | Domain lifecycle + SQLite late-undo test | PASS | DONE can return to ACTIVE only through the bounded Done Undo; the integration test rejects undo after 8.001 seconds and records no extra mutation. |",
"| BOARD-004 | Active oldest first. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-004 | Active oldest first. | Orders Board | `OrdersBoardWorkspace.tsx` | Current-day board snapshot | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Renderer sorts Active by createdAt/display number ascending; rendered ordering has no browser/Electron E2E evidence yet. |",
"| BOARD-005 | Done newest first. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-005 | Done newest first. | Orders Board | `OrdersBoardWorkspace.tsx` | Current-day board snapshot | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Done/history renderer sorts newest first; rendered ordering has no E2E evidence yet. |",
"| BOARD-006 | Waiting age displayed. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-006 | Waiting age displayed. | Orders Board | `OrdersBoardWorkspace.tsx` | Immutable order createdAt | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Active cards calculate/display waiting age and refresh the clock periodically; visual timing is not manually/E2E validated yet. |",
"| BOARD-007 | Active rich order-card grid. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-007 | Active rich order-card grid. | Orders Board | `OrdersBoardWorkspace.tsx`; `orders-board.css` | — | Production build | IMPLEMENTED_NOT_VALIDATED | Responsive rich Active cards are implemented (3/2/1-column breakpoints); rendered visual QA remains pending. |",
"| BOARD-008 | Done/Cancelled/Returned compact rows. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-008 | Done/Cancelled/Returned compact rows. | Orders Board | `OrdersBoardWorkspace.tsx`; `orders-board.css` | — | Production build | IMPLEMENTED_NOT_VALIDATED | History statuses render compact rows; responsive/interaction QA remains pending. |",
"| BOARD-009 | Current Business Day only. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-009 | Current Business Day only. | Orders Board | `OperationsOrdersBoardService.loadBoard`; persistence `listByBusinessDay` | Open Business Day read + business-day-scoped order query | Orders Board SQLite integration test | PASS | Test inserts a historical closed-day order and proves the Board returns only orders belonging to the currently open Business Day, independent of calendar date. |",
"| BOARD-010 | Delivery Done when order leaves location. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-010 | Delivery Done when order leaves location. | Orders Board | `OrdersBoardWorkspace.tsx` | DONE lifecycle metadata | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Delivery Active cards expose Mark Done as the worker departure action; real-world worker interaction semantics still require rendered/operational QA. |",
"| BOARD-011 | Short Mark Done Undo about 5–8 seconds. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-011 | Short Mark Done Undo about 5–8 seconds. | Orders Board | `DONE_UNDO_WINDOW_MS`; `OrdersBoardWorkspace.tsx`; `OperationsOrdersBoardService.undoDone` | Lifecycle `doneAt` + revision | Domain lifecycle + SQLite boundary tests | IMPLEMENTED_NOT_VALIDATED | Authoritative service window is 8s and renderer exposes a 7s Undo toast; backend boundary is automated, while the rendered toast interaction is not E2E validated. |",
"| BOARD-012 | Search Order # only across current Business Day statuses. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-012 | Search Order # only across current Business Day statuses. | Orders Board | `OrdersBoardWorkspace.tsx` | Current Business Day snapshot | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Search input accepts Order # digits and filters the already current-day snapshot across statuses; renderer interaction still lacks E2E evidence. |",
"| BOARD-013 | Details drawer/sheet. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-013 | Details drawer/sheet. | Orders Board | `OrdersBoardWorkspace.tsx`; `orders-board.css` | Immutable order snapshot | Production build/strict typecheck | IMPLEMENTED_NOT_VALIDATED | Full-height responsive details surface includes items/customizations/notes, Delivery details, payments/total/worker/time, receipt preview/reprint and state actions; visual interaction QA pending. |",
"| BOARD-014 | Cancel ACTIVE only. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-014 | Cancel ACTIVE only. | Orders Board | `cancelActiveOrder`; `OperationsOrdersBoardService.cancelOrder` | Cancellation lifecycle + optional compensating stock movements | Domain lifecycle + Orders Board SQLite tests | PASS | Domain rejects cancellation outside ACTIVE; prepared/not-prepared cancellation paths are tested with exact inventory side effects. |",
"| BOARD-015 | DONE Delivery may become RETURNED. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-015 | DONE Delivery may become RETURNED. | Orders Board | `returnFailedDelivery`; `OperationsOrdersBoardService.returnDelivery` | RETURNED lifecycle + linked Delivery Failed expense | Domain lifecycle + Orders Board SQLite tests | PASS | DONE Delivery is the only accepted return transition; successful return is atomic with expense/audit/outbox facts. |",
"| BOARD-016 | Active Delivery card shows Customer Name + Zone. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-016 | Active Delivery card shows Customer Name + Zone. | Orders Board | `OrdersBoardWorkspace.tsx` | Delivery snapshot | Production build | IMPLEMENTED_NOT_VALIDATED | Active Delivery card renders customer name + zone without phone/address/payment detail; visual QA pending. |",
"| BOARD-017 | No On-site orders tab. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-017 | No On-site orders tab. | Orders Board | `OrdersBoardWorkspace.tsx` | — | Production build/source review | IMPLEMENTED_NOT_VALIDATED | Status tabs are exactly Active/Done/Cancelled/Returned and no On-site/source sub-tab is implemented; final rendered audit remains pending. |",
"| BOARD-018 | No current new-order sound. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-018 | No current new-order sound. | Orders Board | `OrdersBoardWorkspace.tsx` | — | Production build/source review | IMPLEMENTED_NOT_VALIDATED | No audio/new-order sound capability is wired in the Phase 5 renderer; final rendered/product audit remains pending. |",
"| BOARD-019 | Keep source/channel future-ready without unused UI. | Orders Board | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| BOARD-019 | Keep source/channel future-ready without unused UI. | Orders Board | `OrderSnapshot.source`; `OrdersBoardWorkspace.tsx` | Immutable source snapshot | Strict typecheck/source review | IMPLEMENTED_NOT_VALIDATED | Source remains in the domain snapshot for future channels while the Board exposes no unused source filter/control; final renderer audit pending. |",
"| EXP-007 | Delivery Failed record locked and non-financial. | Expenses | — | — | — | NOT_STARTED | Appendix B approved decision register |":
"| EXP-007 | Delivery Failed record locked and non-financial. | Expenses | `OperationsOrdersBoardService.returnDelivery`; future Expenses renderer still pending | `DELIVERY_FAILED` expense with null amount/payer | Orders Board SQLite integration test | IMPLEMENTED_NOT_VALIDATED | Backend creates the linked non-financial locked-type record atomically and exposes no mutation in the current Board flow; Expenses-screen presentation/edit restrictions remain a later phase. |",
}
for old, new in rows.items():
    replace(matrix, old, new)

# Architecture: add the Phase 5 command/state boundary.
replace(
    'docs/ARCHITECTURE.md',
    '  Orders/session services and native capability ports',
    '  Orders/Orders Board/session services and native capability ports',
)
replace(
    'docs/ARCHITECTURE.md',
    'Placed orders are structured immutable snapshots. Payment business behavior uses stable logic types rather than display-name comparisons. Delivery Failed Expenses use `amount = null` semantics. Inventory uses an append-only movement ledger with exact signed quantity micro-units.\n\nPhase 4 adds a durable `OrderDraft` model',
    'Placed orders are structured historical snapshots. Commercial/payment/fulfillment/item facts remain immutable after checkout; Phase 5 adds explicit operational lifecycle metadata (`revision`, `doneAt`, cancellation, return) updated only through narrow audited transitions. Payment business behavior uses stable logic types rather than display-name comparisons. Delivery Failed Expenses use `amount = null` semantics. Inventory uses an append-only movement ledger with exact signed quantity micro-units.\n\nPhase 4 adds a durable `OrderDraft` model',
)
replace(
    'docs/ARCHITECTURE.md',
    'Renderer draft edits are serialized through one save queue. Desktop stores drafts in SQLite; browser fallback stores them in IndexedDB. Stale revisions are rejected rather than silently overwriting a newer draft.\n\n## Receipt printing boundary',
    '''Renderer draft edits are serialized through one save queue. Desktop stores drafts in SQLite; browser fallback stores them in IndexedDB. Stale revisions are rejected rather than silently overwriting a newer draft.

## Orders Board command boundary

`OperationsOrdersBoardService` owns current-Business-Day Board loading and the approved operational transitions only: `ACTIVE → DONE`, bounded Done Undo back to `ACTIVE`, `ACTIVE → CANCELLED`, and `DONE Delivery → RETURNED`. There is no general edit/reopen API and no multi-stage kitchen state model.

Every Board transition re-reads the current open Business Day and target order inside the local command boundary. The persistence update is intentionally narrow: it starts from the already saved order and replaces only `status`/lifecycle metadata, preserving items, fulfillment, operator, prices, totals, payments, numbering and receipt history.

Cancellation is compensating rather than destructive. A not-prepared cancellation appends positive `CANCEL_RESTOCK` movements linked to the original negative `ORDER_CONSUMPTION` movements. A prepared cancellation leaves consumption unchanged. Delivery Failed never restores inventory; it atomically writes RETURNED lifecycle state, a linked `DELIVERY_FAILED` expense with `amount = null`, audit facts, and a durable outbox event while the historical order total/payment snapshot stays intact.

The Orders Board renderer uses the same typed application boundary in browser fallback and narrow validated Electron IPC on desktop. It never receives raw storage/native access.

## Receipt printing boundary''',
)

# Data model: explain historical facts vs operational lifecycle and compensation.
replace(
    'docs/DATA_MODEL.md',
    'Placed order content is not modeled as an editable configuration blob. The persistence `OrderRepository` exposes insert/read operations for placed snapshots rather than a general edit API. Later corrections use explicit state transitions/events.',
    '''Placed order commercial content is not modeled as an editable configuration blob. Phase 5 adds optional `OrderLifecycleSnapshot` metadata so orders written before the lifecycle field existed remain readable. Lifecycle metadata carries an operational revision, `doneAt`, cancellation decision/worker/reason, and Delivery Failed return worker/reason.

The persistence `OrderRepository` has no general order editor. Its narrow `updateOperationalState()` starts from the durable saved snapshot and changes only status/lifecycle metadata. Items, fulfillment/customer snapshot, operator, prices, discount, Delivery fee, total, payments, Business Day/display number and idempotency identity are preserved. Corrections therefore remain explicit audited transitions rather than history rewrites.''',
)
replace(
    'docs/DATA_MODEL.md',
    '`null` is intentional and means there is no financial expense amount. It is not equivalent to zero.',
    '''`null` is intentional and means there is no financial expense amount. It is not equivalent to zero.

A DONE Delivery marked Delivery Failed keeps its historical order total/payment snapshot for audit/receipt history, while the return audit/outbox facts explicitly state zero recognized revenue, zero collected payment, reconciliation exclusion, and no inventory restoration. The linked `DELIVERY_FAILED` Expense remains non-financial.''',
)
replace(
    'docs/DATA_MODEL.md',
    'Order checkout appends exact `ORDER_CONSUMPTION` movements after validation inside the same local transaction as the immutable Order. Calculated shortage is not modeled as a reason to mutate or reject the draft by itself; human-controlled Sold Out configuration owns sellability blocking.',
    '''Order checkout appends exact `ORDER_CONSUMPTION` movements after validation inside the same local transaction as the historical Order. If an ACTIVE order is later cancelled before food was prepared, Phase 5 appends a positive `CANCEL_RESTOCK` for each original consumption movement and links it through `compensatesMovementId`; the original movement is never edited/deleted. If food was already prepared, no restock movement is created. Calculated shortage is not modeled as a reason to mutate or reject the draft by itself; human-controlled Sold Out configuration owns sellability blocking.''',
)
replace(
    'docs/DATA_MODEL.md',
    'Placed Orders already append their `ORDER_PLACED` audit and outbox records inside the same transaction as Order/inventory/customer facts.',
    '''Placed Orders append `ORDER_PLACED` audit/outbox records inside the same transaction as Order/inventory/customer facts. Phase 5 Board transitions similarly append `ORDER_MARKED_DONE`, `ORDER_DONE_UNDONE`, `ORDER_CANCELLED`, or `DELIVERY_RETURNED` audit/outbox work in the same local transaction as the corresponding lifecycle, compensation, or Delivery Failed expense facts. Operational outbox idempotency keys include order lifecycle revision so retries do not ambiguously identify different corrections.''',
)

# Offline/local-first correction semantics.
replace(
    'docs/OFFLINE_AND_SYNC.md',
    'Phase 4 checkout already writes `ORDER_PLACED` outbox work inside the same transaction as the order/inventory/audit mutation. No remote network call is needed for checkout success.',
    '''Phase 4 checkout writes `ORDER_PLACED` outbox work inside the same transaction as the order/inventory/audit mutation. Phase 5 Board transitions likewise write their audit/outbox work atomically with status/lifecycle and any cancellation-restock or Delivery Failed expense effects. No remote network call is needed for checkout or Board-transition success.''',
)
replace(
    'docs/OFFLINE_AND_SYNC.md',
    '## Printing after local commit',
    '''## Orders Board local corrections

Orders Board reads and mutates only the currently open Business Day. A Board action is serialized through the shared application coordinator and re-validates the open Business Day plus target order before committing.

`Mark Done` updates operational lifecycle metadata plus audit/outbox only. Its Undo is authoritative for at most eight seconds and creates a new lifecycle revision; after that window the service rejects reopening.

Cancellation and Delivery Failed remain local-first atomic corrections:

```text
Cancel, food not prepared
→ status/lifecycle CANCELLED
→ append compensating CANCEL_RESTOCK movement(s)
→ audit
→ outbox
→ one commit

Cancel, food prepared
→ status/lifecycle CANCELLED
→ no inventory restoration
→ audit
→ outbox
→ one commit

DONE Delivery → Delivery Failed
→ status/lifecycle RETURNED
→ no inventory restoration
→ linked DELIVERY_FAILED Expense with amount = null
→ audit/outbox zero-revenue + zero-collected-payment + reconciliation-exclusion facts
→ one commit
```

The historical order items/fulfillment/total/payment snapshot is never rewritten by these corrections. If any local write in a correction fails, the transaction rolls back as a unit. Cloud availability is not part of success.

## Printing after local commit''',
)

# Test strategy: promote now-landed Phase 5 automated invariants; keep UI rows conservative.
replace(
    'docs/TEST_STRATEGY.md',
    '## Migration validation',
    '''## Phase 5 Orders Board coverage

Phase 5 adds pure-domain lifecycle tests plus seven SQLite/application integration scenarios for the correction paths most likely to corrupt historical or reconciliation facts.

Automated tests protect:

- the approved state machine (`ACTIVE → DONE`, `ACTIVE → CANCELLED`, `DONE Delivery → RETURNED`) and invalid-transition rejection;
- an eight-second authoritative Done Undo boundary, including rejection after 8.001 seconds without an extra mutation;
- Board loading from the currently open Business Day only, even when historical orders exist on another calendar/closed day;
- Mark Done/Undo creating audit/outbox revisions without changing payments or inventory;
- not-prepared cancellation creating an exact positive `CANCEL_RESTOCK` linked to the original negative `ORDER_CONSUMPTION` movement while preserving order financial facts;
- prepared cancellation creating no restock;
- Delivery Failed preserving the historical order/payment snapshot, creating no stock restoration, inserting exactly one linked `DELIVERY_FAILED` Expense with null amount/payer, and writing audit/outbox return facts;
- terminal/invalid corrections creating no audit, outbox, expense, or inventory side effects.

Strict TypeScript and production builds cover the browser/Electron typed Board clients, IPC validation and React renderer wiring. Sorting, responsive card/row layout, search interaction, details drawer, modal decisions, waiting-age display and the visible Undo toast remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron interaction QA or dedicated E2E evidence exists.

## Migration validation''',
)
replace(
    'docs/TEST_STRATEGY.md',
    '''- cancellation stock compensation;
- Returned Delivery zero-revenue/non-financial Expense semantics;
- Expenses Cash vs Other reconciliation effect;''',
    '''- Expenses Cash vs Other reconciliation effect and manual expense editing/deletion;
- Delivery Failed presentation/lock behavior inside the future Expenses screen;''',
)

# Implementation log: add the validation/evidence closeout without claiming rendered QA.
log = Path('docs/IMPLEMENTATION_LOG.md')
text = log.read_text().rstrip()
addition = '''
- Added pure lifecycle tests and seven SQLite Orders Board integration scenarios covering current-Business-Day scope, Done/Undo boundaries, both cancellation stock paths, Delivery Failed semantics, and invalid-transition no-side-effect guarantees.
- Validation run `32129946499` passed locked install, Prettier, ESLint, strict TypeScript, all 75 unit/integration tests (21 files), Operations browser production build, and Electron main/preload production builds. Its final helper-commit push raced a concurrent branch update; the validated source was committed by the concurrent run and the temporary bytecode artifact was removed separately.
- Renderer-only visual/interaction rows remain `IMPLEMENTED_NOT_VALIDATED`; Phase 5 does not claim manual/E2E UI evidence that was not performed.
- No remote Supabase project was linked or mutated; all Board corrections are local-first and queue durable outbox work for the later sync phase.
'''
if 'Validation run `32129946499`' not in text:
    log.write_text(text + '\n' + addition)

# Remove temporary closeout helpers in the validated docs commit.
Path('.phase5_docs_patch.py').unlink(missing_ok=True)
Path('.github/workflows/phase5-docs-closeout.yml').unlink(missing_ok=True)
