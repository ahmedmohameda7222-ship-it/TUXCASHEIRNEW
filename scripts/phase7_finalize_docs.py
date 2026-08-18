from pathlib import Path


def append_section(path: str, sentinel: str, section: str) -> None:
    file = Path(path)
    text = file.read_text().rstrip()
    if sentinel in text:
        return
    file.write_text(text + "\n\n" + section.strip() + "\n")


append_section(
    "docs/ARCHITECTURE.md",
    "## Bulk Stock command boundary",
    """
## Bulk Stock command boundary

`OperationsBulkStockService` owns the worker-facing physical whole-unit ledger for active `BULK_MANUAL` items. Its worker API contains only board loading, `Finished 1`, positive whole-unit `Add Stock`, and short compensating Undo. There is no worker Reset, direct balance setter, item creation/rename/delete/configuration, cost/purchase entry, or analytics/history management command.

Current Stock is derived from append-only `InventoryMovement` history across Business Days. `BULK_UNIT_FINISHED` appends exactly one negative whole unit; `BULK_STOCK_RECEIVED` appends the received positive whole-unit quantity. Undo never rewrites either movement: it appends `UNDO_BULK_UNIT_FINISHED` or `UNDO_BULK_STOCK_RECEIVED` with `compensatesMovementId` pointing at the original.

`BulkStockStore` has SQLite and IndexedDB adapters. Each worker mutation re-validates the open Business Day, Current Operator, active `BULK_MANUAL` item, command identity, and compensation eligibility before atomically appending movement + audit + durable outbox. The renderer receives only the typed browser/Electron Bulk Stock capability.
""",
)

append_section(
    "docs/DATA_MODEL.md",
    "## Bulk Stock movement projection",
    """
## Bulk Stock movement projection

Bulk Stock has no mutable worker-facing count field. The balance is the exact sum of append-only `InventoryMovement.quantityDeltaMicros` for a `BULK_MANUAL` item, including movements from earlier closed Business Days. Worker-originated Bulk Stock quantities are exact whole units represented with the existing stock micro-unit scale.

Worker movement types are `BULK_UNIT_FINISHED`, `BULK_STOCK_RECEIVED`, `UNDO_BULK_UNIT_FINISHED`, and `UNDO_BULK_STOCK_RECEIVED`. A compensating Undo preserves the original historical fact and links the opposite movement through `compensatesMovementId`.

`Add Stock` is an inventory-only physical receipt event. It has no price/cost/Paid From field and creates no Expense or Purchase financial record. Every committed worker movement carries immutable Business Day, worker, timestamp, command/idempotency identity, audit and outbox attribution.
""",
)

append_section(
    "docs/OFFLINE_AND_SYNC.md",
    "## Bulk Stock local-first mutations",
    """
## Bulk Stock local-first mutations

`Finished 1`, `Add Stock`, and short Undo are local-first operations and do not depend on cloud availability.

```text
resolve open Business Day + Current Operator
→ validate active BULK_MANUAL item / whole-unit input / command identity
→ append inventory movement
→ append audit event
→ append durable outbox event
→ one local commit
```

A retry with the same command UUID resolves to the already committed movement rather than creating another movement. Undo appends the exact opposite movement and the persistence boundary prevents a second compensation. If movement/audit/outbox persistence cannot commit atomically, the worker command fails locally and the movement is not acknowledged.

Balance is derived from durable movement history across Business Days. Phase 7 adds no End Day reset path; the actual End Day phase must still prove that closing a Business Day does not mutate Bulk Stock.
""",
)

append_section(
    "docs/TEST_STRATEGY.md",
    "## Phase 7 Bulk Stock coverage",
    """
## Phase 7 Bulk Stock coverage

Automated Phase 7 coverage protects:

- exact positive whole-unit `Add Stock` validation;
- exact one-whole-unit `Finished 1` decrement;
- current balance derived from movements across a closed and current Business Day;
- exposure of active `BULK_MANUAL` items only;
- stable command UUID replay producing no duplicate movement;
- short Undo as an exact compensating movement with the original history preserved;
- duplicate and expired Undo rejection;
- `Add Stock` creating no Expense/Purchase financial mutation;
- atomic rollback when durable outbox persistence is forced to fail after the movement command begins;
- typed browser/IndexedDB and Electron/SQLite capability wiring through strict TypeScript and production builds.

Rendered card layout, Add Stock dialog interaction, direct `Finished 1`, visible short Undo and responsive behavior remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron QA or dedicated E2E evidence exists.
""",
)

append_section(
    "docs/IMPLEMENTATION_LOG.md",
    "## 2026-08-18 — Phase 7 Bulk Stock implementation",
    """
## 2026-08-18 — Phase 7 Bulk Stock implementation

- Implemented the approved active-`BULK_MANUAL` whole-unit worker ledger on `feat/ops-07-bulk-stock`, stacked on Phase 6 Expenses.
- Enabled final Operations `Bulk Stock` navigation and added Current Stock cards with `Finished 1`, positive whole-unit `Add Stock`, and short compensating Undo only.
- Current Stock is derived from append-only inventory movement history across Business Days; there is no worker balance overwrite or Reset path.
- Added exact `BULK_UNIT_FINISHED`, `BULK_STOCK_RECEIVED` and compensating Undo semantics with stable command UUID idempotency.
- Added SQLite and IndexedDB `BulkStockStore` adapters. Movement + audit + durable outbox commit atomically after Business Day/operator/item checks.
- `Add Stock` is intentionally non-financial: no cost, Paid From, Expense, or Purchase record is created.
- Added typed browser and secure Electron-main/preload boundaries plus the responsive worker-facing page.
- Added domain and SQLite integration tests for cross-Business-Day balance, exact movements, idempotent replay, compensation, expiry/duplicate rejection, non-financial stock receiving, and injected outbox-failure rollback.
- Full repository validation passed locked install, Prettier, ESLint, strict TypeScript, all tests, and production builds before documentation closeout.
- Renderer-only interaction/visual evidence remains pending. End Day itself remains the next phase and must prove that closing does not reset Bulk Stock.
""",
)

matrix_path = Path("docs/OPERATIONS_COMPLIANCE_MATRIX.md")
lines = matrix_path.read_text().splitlines()
rows = {
    "BULK-001": "| BULK-001 | Bulk Stock remains in Operations. | Bulk Stock | `App.tsx`; `BulkStockWorkspace.tsx`; `styles/bulk-stock.css` | — | Production build / strict typecheck | IMPLEMENTED_NOT_VALIDATED | Final worker navigation enables Bulk Stock and renders the page; rendered navigation/layout QA remains pending. |",
    "BULK-002": "| BULK-002 | Purpose is manual tracking of whole bulk units the POS cannot infer. | Bulk Stock | `packages/domain/src/bulkStock.ts`; `OperationsBulkStockService`; `BulkStockWorkspace.tsx` | Exact stock micro-unit ledger | Domain + SQLite Bulk Stock integration tests | PASS | Worker commands accept whole physical units only and are isolated to active `BULK_MANUAL` items rather than recipe-tracked inventory. |",
    "BULK-003": "| BULK-003 | Worker action is `Finished 1` when whole unit actually finishes. | Bulk Stock | `finishedBulkUnitDelta`; `OperationsBulkStockService.finishOne`; `BulkStockWorkspace.tsx` | `BULK_UNIT_FINISHED` movement | Domain + SQLite Bulk Stock integration tests | PASS | The only decrement worker command is explicitly `Finished 1` and appends exactly -1 whole unit. |",
    "BULK-004": "| BULK-004 | Do not decrement merely when opening a unit. | Bulk Stock | `TuxBulkStockApi`; `OperationsBulkStockService`; `BulkStockWorkspace.tsx` | Append-only movement ledger | Source/API review + typecheck | PASS | There is no Open Unit/decrement-on-open command or automatic usage hook; decrement occurs only from the intentional `Finished 1` command. |",
    "BULK-005": "| BULK-005 | Worker can `Add Stock` when physical stock arrives. | Bulk Stock | `receivedBulkStockDelta`; `OperationsBulkStockService.addStock`; Add Stock dialog | `BULK_STOCK_RECEIVED` movement | Domain + SQLite Bulk Stock integration tests | PASS | Positive safe whole units append an exact received-stock movement. |",
    "BULK-006": "| BULK-006 | Add Stock is not automatically a financial Purchase. | Bulk Stock | `OperationsBulkStockService.addStock`; `BulkStockWorkspace.tsx` | Inventory movement only | SQLite Bulk Stock integration test | PASS | Add Stock accepts only item + whole units and integration proves no Expense row is created; no Purchase/cost/Paid From path exists. |",
    "BULK-007": "| BULK-007 | Stock uses movement ledger, not direct overwrite. | Bulk Stock | `bulkStockBalance`; `BulkStockStore` SQLite/IndexedDB adapters | Append-only `inventory_movements` | Domain + SQLite Bulk Stock integration tests | PASS | Current Stock is calculated by summing durable movements; worker API exposes no balance setter. |",
    "BULK-008": "| BULK-008 | Worker cannot create/rename/delete/configure/reset items. | Bulk Stock | `TuxBulkStockApi`; `OperationsBulkStockService`; `BulkStockWorkspace.tsx` | Existing configured InventoryItem records are read-only to this workflow | Typecheck / production build / API review | PASS | Worker capability contains only load, Finished 1, Add Stock and Undo; no configuration/destructive item command exists. |",
    "BULK-009": "| BULK-009 | Bulk Stock balance persists across Business Days. | Bulk Stock | `OperationsBulkStockService.loadBoard`; `BulkStockStore.listMovements` | Movement history is not Business-Day-filtered for balance | SQLite Bulk Stock integration test | PASS | Fixture carries a five-unit balance from a closed historical Business Day into the current day before new movements. |",
    "BULK-010": "| BULK-010 | No End Day reset. | Bulk Stock | Phase 7 contains no reset path; End Day not implemented yet | — | — | NOT_STARTED | Phase 7 deliberately adds no reset. The actual End Day phase must prove closing a Business Day leaves Bulk Stock unchanged except for recorded movements. |",
    "BULK-011": "| BULK-011 | Short Undo creates compensating movement. | Bulk Stock | `canUndoBulkMovement`; `undoBulkMovementDelta`; `OperationsBulkStockService.undoMovement` | Linked `UNDO_BULK_*` movement | Domain + SQLite Bulk Stock integration tests | PASS | Authoritative 8-second window appends the exact opposite movement and rejects expired/already-compensated attempts. |",
    "BULK-012": "| BULK-012 | Later correction belongs in Admin Stock Adjustment. | Bulk Stock | Operations intentionally exposes no later adjustment API | Future Admin | — | NOT_STARTED | Operations correctly stops after the short Undo window. The later Admin Stock Adjustment capability is future Admin scope and is not implemented in Phase 7. |",
}

seen = set()
out = []
for line in lines:
    replacement = None
    for key, value in rows.items():
        if line.startswith(f"| {key} |"):
            replacement = value
            seen.add(key)
            break
    out.append(replacement or line)
missing = set(rows) - seen
if missing:
    raise SystemExit(f"Missing Bulk Stock compliance rows: {sorted(missing)}")
matrix_path.write_text("\n".join(out) + "\n")
