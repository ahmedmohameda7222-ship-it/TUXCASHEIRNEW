from pathlib import Path


def insert_before(path: str, marker: str, addition: str, sentinel: str) -> None:
    file = Path(path)
    text = file.read_text()
    if sentinel in text:
        return
    if marker not in text:
        raise SystemExit(f'marker missing in {path}: {marker!r}')
    file.write_text(text.replace(marker, addition.rstrip() + '\n\n' + marker, 1))


architecture = Path('docs/ARCHITECTURE.md')
text = architecture.read_text().replace(
    '  Orders/Orders Board/session services and native capability ports',
    '  Orders/Orders Board/Expenses/session services and native capability ports',
)
architecture.write_text(text)
insert_before(
    'docs/ARCHITECTURE.md',
    '## Receipt printing boundary',
    '''## Expenses command boundary

`OperationsExpensesService` owns the current-Business-Day operational Expenses ledger. Manual create/edit/delete commands require the currently open Business Day and Current Operator, use exact `MoneyMinor`, and serialize through the shared application coordinator.

Manual removal is an audited soft-delete: the entry leaves the operational ledger and totals but its durable record remains historical. `CASH` and `OTHER` both contribute to Total Expenses; only `CASH` contributes to the separate `cashExpensesMinor` projection consumed later by End Day reconciliation. System `DELIVERY_FAILED` records are read-only, keep `amount = null`, and never contribute to either total.

Expense mutations use a dedicated `ExpenseLedgerStore`, analogous to the separate draft store. SQLite and IndexedDB adapters atomically persist the manual expense state, audit event, and durable outbox event while re-validating Business Day/operator context and optimistic expense revision. Electron exposes only typed Expenses IPC; the renderer receives no SQLite handle.''',
    '## Expenses command boundary',
)
insert_before(
    'docs/ARCHITECTURE.md',
    '### Desktop SQLite',
    '''Current-day manual Expenses use the separate `ExpenseLedgerStore` contract. It shares the same physical SQLite/IndexedDB data with Operations but narrows the mutation surface to revision-checked manual expense changes plus their audit/outbox effects in one durable transaction. Existing `DELIVERY_FAILED` records remain readable through the ledger without becoming editable.''',
    'Current-day manual Expenses use the separate `ExpenseLedgerStore` contract.',
)

insert_before(
    'docs/DATA_MODEL.md',
    '## Inventory',
    '''Phase 6 projects manual Expenses through `ExpenseLedgerRecord`. Manual rows carry operational lifecycle metadata (`revision`, last edit attribution/time, soft-delete attribution/time). Legacy manual rows without lifecycle metadata are upgraded in memory to revision zero. Editing preserves immutable identity and original creation time. Delete is a soft-delete: it removes the row from the current operational ledger/totals while preserving the durable database fact and audit history.

`calculateExpenseTotals()` returns two exact projections: `totalExpensesMinor` includes every active manual Cash/Other expense, while `cashExpensesMinor` includes only active manual Cash expenses for later Expected Cash calculation. `DELIVERY_FAILED` and soft-deleted manual rows contribute to neither projection. System Delivery Failed rows remain locked from manual edit/delete.''',
    'Phase 6 projects manual Expenses through `ExpenseLedgerRecord`.',
)
insert_before(
    'docs/DATA_MODEL.md',
    '## Receipt projection',
    '''Phase 6 manual Expense create/edit/delete commits its audit and outbox intent atomically with the revision-checked expense mutation. Expense outbox identity includes immutable Expense ID, lifecycle revision, and event type so separate corrections cannot collapse into one sync identity.''',
    'Phase 6 manual Expense create/edit/delete commits its audit',
)

insert_before(
    'docs/OFFLINE_AND_SYNC.md',
    '## Printing after local commit',
    '''## Expenses local ledger mutations

Manual Expense create/edit/delete is local-first. The application resolves the current open Business Day and Current Operator, then `ExpenseLedgerStore` re-validates both inside the durable mutation boundary.

```text
manual expense create/edit/soft-delete
→ revision/context check
→ write manual expense state
→ append audit event
→ append durable outbox event
→ one local commit
```

If audit/outbox persistence fails, the manual expense mutation rolls back with it. SQLite integration injects an outbox primary-key collision and proves that neither the Expense nor its audit row partially survives. `DELIVERY_FAILED` records remain read-only/non-financial. Soft-deleted manual rows remain stored but are excluded from the operational list and exact Cash/Total projections.''',
    '## Expenses local ledger mutations',
)
offline = Path('docs/OFFLINE_AND_SYNC.md')
text = offline.read_text()
old = 'Phase 4 checkout writes `ORDER_PLACED` outbox work inside the same transaction as the order/inventory/audit mutation. Phase 5 Board transitions likewise write their audit/outbox work atomically with status/lifecycle and any cancellation-restock or Delivery Failed expense effects. No remote network call is needed for checkout or Board-transition success.'
new = 'Phase 4 checkout writes `ORDER_PLACED` outbox work inside the same transaction as the order/inventory/audit mutation. Phase 5 Board transitions likewise write their audit/outbox work atomically with status/lifecycle and any cancellation-restock or Delivery Failed expense effects. Phase 6 manual Expense create/edit/delete writes the corresponding expense revision plus audit/outbox work atomically. No remote network call is needed for checkout, Board-transition, or Expense-ledger success.'
if old in text:
    text = text.replace(old, new, 1)
offline.write_text(text)

insert_before(
    'docs/TEST_STRATEGY.md',
    '## Migration validation',
    '''## Phase 6 Expenses coverage

Phase 6 adds domain and SQLite integration coverage for the current-Business-Day operational ledger.

Automated tests protect:

- manual Description/Amount/Paid From/optional Note validation using exact minor units;
- legacy manual rows upgrading to revision-zero lifecycle metadata;
- exact Total Expenses across Cash + Other and a separate exact Cash-only subtotal for later Expected Cash;
- current open Business Day isolation and newest-first ledger ordering independent of calendar date;
- edit preserving Expense identity/original creation time while incrementing revision and changing totals correctly;
- audited soft-delete removing a manual row from current ledger/totals while preserving its database payload;
- Delivery Failed remaining visible, locked and excluded from both financial totals;
- historical Business Day mutation rejection without audit/outbox side effects;
- atomic rollback when outbox persistence fails after expense/audit work has begun.

Strict TypeScript and production builds cover the typed browser/Electron Expenses client, preload validation, dedicated native IPC boundary and renderer wiring. Add/Edit/Delete dialog interaction, responsive ledger presentation, visible Total Expenses, and newest-first rendered ordering remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron QA or dedicated E2E evidence exists.''',
    '## Phase 6 Expenses coverage',
)
tests = Path('docs/TEST_STRATEGY.md')
lines = tests.read_text().splitlines()
lines = [
    line
    for line in lines
    if line
    not in {
        '- Expenses Cash vs Other reconciliation effect and manual expense editing/deletion;',
        '- Delivery Failed presentation/lock behavior inside the future Expenses screen;',
    }
]
tests.write_text('\n'.join(lines) + '\n')

log = Path('docs/IMPLEMENTATION_LOG.md')
text = log.read_text().rstrip()
if '## 2026-08-18 — Phase 6 Expenses implementation' not in text:
    text += '''

## 2026-08-18 — Phase 6 Expenses implementation

- Created `feat/ops-06-expenses` from the clean Phase 5 Orders Board head and kept the work stacked; `main` and remote Supabase remain untouched.
- Added the current-open-Business-Day Expenses ledger with exact `MoneyMinor` manual Description/Amount/Paid From Cash|Other/optional Note semantics.
- Added explicit manual expense lifecycle revisions for audited edit and soft-delete. Delete removes the entry from the current operational ledger/totals without destructively deleting the durable database fact.
- Added exact `totalExpensesMinor` and separate `cashExpensesMinor` projections. Cash and Other both count as Expenses; only Cash is carried forward as a drawer deduction for later End Day Expected Cash. Delivery Failed and soft-deleted entries are excluded.
- Added a dedicated `ExpenseLedgerStore` boundary with SQLite and IndexedDB adapters. Manual Expense mutation, audit and durable outbox intent commit atomically with Business Day/operator/revision revalidation.
- Kept `DELIVERY_FAILED` system records locked, `amount = null`, non-financial and visible in the current ledger; no manual edit/delete path is exposed.
- Added typed browser client, validated Electron preload IPC, isolated Electron-main Expenses IPC runtime, and the worker-facing Expenses page with Add/Edit/Delete dialogs, top Total Expenses and newest-first compact rows.
- Added domain tests and SQLite integration covering current-vs-historical Business Day scope, exact Cash/Other totals, edit identity/revision behavior, durable soft-delete history, locked Delivery Failed semantics, historical mutation rejection and injected outbox-failure rollback.
- Permanent clean code-head CI run `32133776774` on `83a422af1b5f69e38287883a350bc0b20a668a69` passed locked install, Prettier, ESLint, strict TypeScript, all unit/integration tests, browser production build, and Electron main/preload production builds before documentation synchronization.
- Renderer-only visual/interaction requirements remain `IMPLEMENTED_NOT_VALIDATED`; End Day archival/removal from the operational view remains the later End Day phase and is not claimed here.
'''
log.write_text(text + '\n')

rows = {
    'EXP-001': '| EXP-001 | Current Business Day operational ledger. | Expenses | `OperationsExpensesService.loadLedger`; `ExpensesWorkspace.tsx` | `ExpenseLedgerStore.listByBusinessDay(businessDayId)` | Expenses SQLite integration test | PASS | Service resolves the immutable currently OPEN Business Day and the integration test proves a closed historical day is excluded independent of calendar date. |',
    'EXP-002': '| EXP-002 | Manual Expense = Description + Amount + Paid From + optional Note. | Expenses | `packages/domain/src/expense.ts`; `OperationsExpensesService`; `ExpensesWorkspace.tsx` | Manual Expense aggregate + exact minor units | Domain + Expenses SQLite integration tests | PASS | Domain validates/normalizes the approved four-field shape and SQLite integration proves exact durable create semantics with audit/outbox. |',
    'EXP-003': '| EXP-003 | Paid From = Cash / Other. | Expenses | `expense.ts`; `ExpensesWorkspace.tsx` | `paidFrom = CASH | OTHER` | Domain + Expenses SQLite integration tests | PASS | Only Cash/Other are accepted and both durable paths are covered. |',
    'EXP-004': '| EXP-004 | Cash expense reduces Expected Cash. | Expenses | `calculateExpenseTotals`; `OperationsExpensesService.loadLedger` | Exact `cashExpensesMinor` projection | Domain + Expenses SQLite integration tests | PASS | Current active Cash expenses are separately summed exactly for later End Day Expected Cash; Other/system/deleted rows are excluded. |',
    'EXP-005': '| EXP-005 | Other expense does not change drawer Expected Cash. | Expenses | `calculateExpenseTotals`; `OperationsExpensesService.loadLedger` | Cash-only projection separate from Total Expenses | Domain + Expenses SQLite integration tests | PASS | Other contributes to Total Expenses but not `cashExpensesMinor`, proven with mixed Cash/Other fixtures. |',
    'EXP-006': '| EXP-006 | Manual current-day expense editable/deletable. | Expenses | `editManualExpense`; `deleteManualExpense`; `OperationsExpensesService`; `ExpensesWorkspace.tsx` | Revision-checked manual record + audit/outbox | Domain + Expenses SQLite integration tests; production build | IMPLEMENTED_NOT_VALIDATED | Backend edit/soft-delete semantics, current-day restriction and atomic audit/outbox are tested; rendered Edit/Delete dialog interaction has no manual/E2E evidence yet. |',
    'EXP-007': '| EXP-007 | Delivery Failed record locked and non-financial. | Expenses | `OperationsOrdersBoardService.returnDelivery`; `OperationsExpensesService`; `ExpensesWorkspace.tsx` | `DELIVERY_FAILED` expense with null amount/payer | Orders Board + Expenses SQLite integration tests | PASS | Delivery Failed is loaded visibly but manual edit/delete is rejected, remains amount/payer null and contributes to neither Total Expenses nor Cash subtotal. |',
    'EXP-008': '| EXP-008 | Show Total Expenses for current Business Day. | Expenses | `calculateExpenseTotals`; `ExpensesWorkspace.tsx` | Exact `totalExpensesMinor` projection | Domain + Expenses SQLite integration tests; production build | IMPLEMENTED_NOT_VALIDATED | Exact total semantics are automated and the top-level Total Expenses renderer is implemented; rendered visual QA is still pending. |',
    'EXP-009': '| EXP-009 | Newest-first compact list. | Expenses | `ExpenseLedgerStore.listByBusinessDay`; `ExpensesWorkspace.tsx`; `expenses.css` | Business-Day-scoped chronological read | Expenses SQLite integration test; production build | IMPLEMENTED_NOT_VALIDATED | Store/service ordering is tested newest-first and compact rows are implemented; rendered responsive ordering remains unvalidated. |',
    'EXP-011': '| EXP-011 | No destructive database deletion. | Expenses | `deleteManualExpense`; `ExpenseLedgerStore.commitMutation` | Manual lifecycle `deletedAt/deletedByWorkerId` | Domain + Expenses SQLite integration tests | PASS | Delete is a revisioned soft-delete. Integration proves the durable expense row remains with deletion metadata while leaving the current ledger/totals. |',
}
matrix = Path('docs/OPERATIONS_COMPLIANCE_MATRIX.md')
out = []
seen = set()
for line in matrix.read_text().splitlines():
    replacement = None
    for key, value in rows.items():
        if line.startswith(f'| {key} |'):
            replacement = value
            seen.add(key)
            break
    out.append(replacement or line)
missing = set(rows) - seen
if missing:
    raise SystemExit(f'missing compliance rows: {sorted(missing)}')
matrix.write_text('\n'.join(out) + '\n')
