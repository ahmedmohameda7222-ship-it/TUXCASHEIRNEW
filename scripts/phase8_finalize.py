from pathlib import Path


def append_section(path: str, sentinel: str, section: str) -> None:
    file = Path(path)
    text = file.read_text().rstrip()
    if sentinel not in text:
        file.write_text(text + "\n\n" + section.strip() + "\n")


# Strengthen integration evidence: successful non-zero variance closes with a reason and creates no variance expense.
test = Path("apps/operations-desktop/src/main/endDay.integration.test.ts")
text = test.read_text()
if "const successfulVarianceActuals" not in text:
    marker = """const noVarianceReasons = [
  { paymentMethodId: CASH_ID, reason: null },
  { paymentMethodId: DIGITAL_ID, reason: null },
] as const;
"""
    addition = marker + """
const successfulVarianceActuals = [
  { paymentMethodId: CASH_ID, actualMinor: moneyMinor(7_000) },
  { paymentMethodId: DIGITAL_ID, actualMinor: moneyMinor(5_000) },
] as const;

const successfulVarianceReasons = [
  { paymentMethodId: CASH_ID, reason: 'Cash drawer recount' },
  { paymentMethodId: DIGITAL_ID, reason: null },
] as const;
"""
    if marker not in text:
        raise SystemExit("End Day test constants marker missing")
    text = text.replace(marker, addition, 1)

old_pair = """      actualPayments: exactActuals,
      varianceReasons: noVarianceReasons,
"""
new_pair = """      actualPayments: successfulVarianceActuals,
      varianceReasons: successfulVarianceReasons,
"""
if text.count(old_pair) >= 2:
    text = text.replace(old_pair, new_pair, 2)
elif "successfulVarianceActuals" not in text[text.find("closes locally across midnight"):]:
    raise SystemExit("Expected successful End Day close/replay inputs were not found")

movement_assertion = """    expect(rows(fx.databasePath, 'SELECT id FROM inventory_movements')).toHaveLength(
      movementsBefore,
    );
"""
if "varianceReason: 'Cash drawer recount'" not in text:
    insert = movement_assertion + """    expect(rows(fx.databasePath, 'SELECT id FROM expenses')).toHaveLength(1);
    const persistedReconciliation = JSON.parse(
      String(
        rows(
          fx.databasePath,
          'SELECT payload_json FROM reconciliations WHERE business_day_id = ?',
          DAY_ID,
        )[0]?.['payload_json'],
      ),
    ) as { lines: Array<{ differenceMinor: number; varianceReason: string | null }> };
    expect(persistedReconciliation.lines[0]).toMatchObject({
      differenceMinor: -500,
      varianceReason: 'Cash drawer recount',
    });
"""
    if movement_assertion not in text:
        raise SystemExit("Bulk Stock carry-forward assertion marker missing")
    text = text.replace(movement_assertion, insert, 1)
test.write_text(text)

append_section(
    "docs/ARCHITECTURE.md",
    "## End Day / reconciliation boundary",
    """
## End Day / reconciliation boundary

`OperationsEndDayService` owns the mandatory Business Day closing command and is reachable only from the Current Operator/profile menu. It shares the application command coordinator with normal operational writes, so checkout, order corrections, Expenses, Bulk Stock and closing cannot interleave unsafe local transactions.

End Day first gates the current OPEN Business Day. Any ACTIVE placed order hard-blocks reconciliation. A meaningful durable `OrderDraft` also blocks until the worker explicitly returns to Orders or chooses `Discard Draft & Continue`; the service never silently destroys draft state.

The READY gate exposes only active reconciliation payment identities and labels. Expected values are deliberately absent. The worker enters actual Cash first and then active Digital methods. Only after all actual amounts are supplied does the service derive Expected values from durable current-Business-Day facts: DONE orders contribute recognized sales/payment allocations, Cancelled and Returned Delivery orders do not, and active manual Cash expenses reduce Expected Cash. Other expenses do not reduce the drawer.

Final close builds an immutable reconciliation and commits reconciliation + Worker Session end + Business Day CLOSED transition + audit + durable outbox facts in one local database transaction. A local failure rolls back the close and leaves the Business Day open. An already-closed Business Day returns an idempotent replay result without new close writes. No cloud, PDF or printer call participates in the close transaction.
""",
)

append_section(
    "docs/DATA_MODEL.md",
    "## End Day reconciliation snapshot",
    """
## End Day reconciliation snapshot

A successful End Day persists the existing `Reconciliation` aggregate for the closing Business Day. Each line snapshots payment method identity/label/logic type together with exact `expectedMinor`, blind-entered `actualMinor`, signed `differenceMinor = actual - expected`, and `varianceReason` when the difference is non-zero.

Expected collection is derived from immutable order/payment snapshots but recognizes only `DONE` orders. `CANCELLED` and `RETURNED` orders remain historical records and contribute zero to expected collection. Current manual Cash expenses are deducted from the Cash expectation; Other expenses and non-financial Delivery Failed expense rows do not reduce expected drawer Cash.

Closing changes the existing Business Day from OPEN to CLOSED and ends the current Worker Session. It does not create the next Business Day, reset Bulk Stock, delete orders/expenses, or rewrite historical commercial/payment facts. A new Business Day receives a new identity and starts its display order counter at zero so its first allocation is #1.
""",
)

append_section(
    "docs/OFFLINE_AND_SYNC.md",
    "## End Day local close",
    """
## End Day local close

End Day is offline-first and has no remote success dependency.

```text
resolve current OPEN Business Day + Current Operator
→ block ACTIVE orders
→ require explicit durable-draft resolution
→ collect blind actual reconciliation values
→ reveal exact Expected / Actual / Difference
→ require reason for every non-zero variance
→ final closing summary
→ one local transaction:
   Reconciliation + Worker Session end + Business Day close + audit + outbox
→ return Operations to no-active-Business-Day state
→ cloud outbox delivery may happen later
```

A local persistence failure blocks closing and the transaction rolls back. Network/Supabase availability cannot block a valid local close because no remote request is made. Repeating `closeDay` for the same already-closed Business Day is a no-write idempotent replay. No automatic PDF, print or next-day creation occurs.
""",
)

append_section(
    "docs/TEST_STRATEGY.md",
    "## Phase 8 End Day coverage",
    """
## Phase 8 End Day coverage

Automated Phase 8 coverage protects:

- Cash-first reconciliation ordering with current Cash/Digital methods and no Card reconciliation path;
- ACTIVE orders hard-blocking End Day before reconciliation mutation;
- meaningful durable drafts remaining intact until explicit discard;
- READY gate returning payment method identity only, with no Expected-value leakage;
- DONE-only recognized sales/payment collection, with Cancelled and Returned Delivery excluded;
- exact Cash expectation after Cash-paid Expenses;
- exact signed variance and mandatory reason for non-zero difference;
- successful close with a non-zero variance reason and no automatic variance Expense;
- cross-midnight Business Day close, current Worker Session end, reconciliation/audit/outbox persistence;
- Bulk Stock movement history remaining unchanged by End Day;
- replaying close on an already-closed Business Day producing no duplicate reconciliation/close outbox;
- injected outbox persistence failure rolling back reconciliation, session end, Business Day close and close audit;
- new Business Day display-order allocation beginning at #1.

Strict TypeScript and production builds validate browser/Electron End Day boundaries. Profile-menu interaction, blind-count presentation, Final Closing Summary rendering and post-close locked-screen transition remain `IMPLEMENTED_NOT_VALIDATED` until rendered QA/E2E evidence exists.
""",
)

append_section(
    "docs/IMPLEMENTATION_LOG.md",
    "## 2026-08-18 — Phase 8 End Day / reconciliation implementation",
    """
## 2026-08-18 — Phase 8 End Day / reconciliation implementation

- Implemented Profile → End Day on `feat/ops-08-end-day`, stacked on the completed Phase 7 Bulk Stock branch.
- Added ACTIVE-order hard block and explicit durable-draft Return/Discard resolution; no silent draft loss.
- Added blind Cash-first then Digital actual counting. Expected values remain absent from the READY gate and are revealed only after all actual entries are submitted.
- Added exact DONE-only recognized sales/payment projection, Returned/Cancelled exclusion, Cash-expense deduction and signed variance calculation.
- Non-zero variance requires a reason but does not block a valid close; variance remains a reconciliation fact and creates no automatic Expense/Revenue.
- Added Final Closing Summary without Profit/Margin/COGS.
- Added one durable local close transaction for reconciliation + Worker Session end + Business Day CLOSED state + audit + outbox. Local failure rolls back; cloud/printing are not dependencies.
- Added no-write idempotent replay for an already-closed Business Day, no automatic next day, and verified next-day order numbering starts at #1.
- Added browser + secure Electron End Day APIs and responsive worker flow. Successful close refreshes session state back to the existing no-active-day screen.
- Integration coverage proves cross-midnight close, Bulk Stock carry-forward, successful variance close, no variance Expense, and injected outbox-failure rollback.
- Repository-side Supabase remains intentionally unlinked; migrations stay versioned for the user to apply manually after planner completion.
""",
)

matrix = Path("docs/OPERATIONS_COMPLIANCE_MATRIX.md")
lines = matrix.read_text().splitlines()
rows = {
    "ORD-030": "| ORD-030 | Draft never silently disappears at End Day. | Orders | `OperationsEndDayService`; `EndDayFlow.tsx` | Durable `OrderDraftStore` | End Day SQLite integration test | PASS | Meaningful draft hard-blocks End Day, remains durable, and can proceed only after explicit discard; renderer also offers Return to Order. |",
    "EXP-010": "| EXP-010 | End Day clears Expenses from operational view and archives them to Reports/history. | Expenses | `OperationsExpensesService`; `OperationsEndDayService` | Expenses retained by immutable Business Day ID | Expenses + End Day SQLite tests | PASS | Closing preserves old Expense rows under the closed Business Day. Operational Expenses resolve only the currently OPEN Business Day, so a later new day starts with an empty current-day ledger without destructive deletion. |",
    "BULK-010": "| BULK-010 | No End Day reset. | Bulk Stock | `OperationsEndDayService`; Bulk Stock append-only ledger | Existing `inventory_movements` unchanged | End Day SQLite integration test | PASS | Integration records Bulk Stock before close and proves End Day writes no new/reset inventory movement; physical balance therefore carries forward unchanged except for recorded movements. |",
    "END-001": "| END-001 | Reconciliation mandatory inside End Day. | End Day / Reconciliation | `OperationsEndDayService.closeDay`; `EndDayFlow.tsx` | Reconciliation + Business Day close in same local transaction | End Day SQLite integration tests | PASS | A Business Day reaches CLOSED only through the End Day close command that builds and persists reconciliation in the same transaction. |",
    "END-002": "| END-002 | End Day launched from profile/operator menu. | End Day / Reconciliation | `App.tsx`; `EndDayFlow.tsx` | — | Production build / strict typecheck | IMPLEMENTED_NOT_VALIDATED | End Day is enabled only in the operator/profile menu and not top-level navigation; rendered menu/modal interaction still needs E2E QA. |",
    "END-003": "| END-003 | Current real payment methods: Cash + Instapay. | End Day / Reconciliation | `endDayReconciliationMethods`; `EndDayFlow.tsx` | Dynamic Cash/Digital payment snapshots | Domain + End Day SQLite tests | PASS | Reconciliation selects active CASH then DIGITAL methods; fixtures prove Cash followed by the configured Instapay digital method. |",
    "END-004": "| END-004 | No Card reconciliation UI now. | End Day / Reconciliation | `endDayReconciliationMethods` | Cash/Digital-only reconciliation projection | Domain tests / source review | PASS | CARD is excluded from current End Day reconciliation methods and the renderer receives only the filtered method list. |",
    "END-005": "| END-005 | No Opening Cash/Float. | End Day / Reconciliation | `EndDayFlow.tsx`; `OperationsEndDayService` | — | Typecheck / source review | PASS | End Day has no Opening Cash/Float field, state, calculation or persistence path. |",
    "END-006": "| END-006 | Blind actual entry before Expected values are revealed. | End Day / Reconciliation | `OperationsEndDayService.beginEndDay`; `EndDayFlow.tsx` | READY gate excludes expectations | End Day SQLite integration test | PASS | Integration proves the READY payload contains payment identities only and no `expectedMinor`; expectations appear only after actual values are submitted. |",
    "END-007": "| END-007 | Cash expected = eligible Cash collected − Cash-paid Expenses. | End Day / Reconciliation | `calculateEndDayFinancialProjection` | Exact minor-unit payment + Expense projection | Domain + End Day SQLite tests | PASS | DONE Cash allocations are summed exactly and active manual Cash expenses are subtracted before reconciliation. |",
    "END-008": "| END-008 | Returned Delivery excluded from expected payment collection. | End Day / Reconciliation | `calculateEndDayFinancialProjection` | DONE-only recognition | Domain + End Day SQLite tests | PASS | RETURNED orders remain historical snapshots but are excluded from recognized sales and expected payment collection. |",
    "END-009": "| END-009 | Variance does not block closing. | End Day / Reconciliation | `OperationsEndDayService.closeDay` | Reconciliation signed difference | End Day SQLite successful-variance close test | PASS | A non-zero Cash difference with a reason closes successfully; the variance is preserved on the reconciliation line. |",
    "END-010": "| END-010 | Non-zero variance requires reason. | End Day / Reconciliation | `normalizeEndDayVarianceReason`; `OperationsEndDayService` | `ReconciliationLine.varianceReason` | Domain + End Day SQLite tests | PASS | Missing reason returns validation failure and leaves the Business Day open; non-zero successful close persists the trimmed reason. |",
    "END-011": "| END-011 | Variance remains its own reconciliation fact, not automatic Expense/Revenue. | End Day / Reconciliation | `OperationsEndDayService`; reconciliation domain | Reconciliation line only | End Day SQLite successful-variance test | PASS | Successful variance close persists difference/reason while Expense row count remains only the pre-existing manual Expense; no variance Expense/Revenue is generated. |",
    "END-012": "| END-012 | ACTIVE orders hard-block End Day. | End Day / Reconciliation | `OperationsEndDayService.beginEndDay/closeDay`; `EndDayFlow.tsx` | Current Business Day order query | End Day SQLite integration test | PASS | ACTIVE order numbers are returned as a hard block and reconciliation is not created. |",
    "END-013": "| END-013 | Draft requires Return to Order or Discard Draft & Continue. | End Day / Reconciliation | `OperationsEndDayService`; `EndDayFlow.tsx` | Durable draft store | End Day SQLite integration test; production build | IMPLEMENTED_NOT_VALIDATED | Backend proves draft cannot disappear and explicit discard is required; renderer implements both Return and Discard choices, pending rendered interaction QA. |",
    "END-014": "| END-014 | Final Closing Summary before final close. | End Day / Reconciliation | `EndDayFlow.tsx`; `end-day.css` | Reconciliation preview | Production build / strict typecheck | IMPLEMENTED_NOT_VALIDATED | Final Closing Summary with sales, expenses and payment reconciliation is implemented before Close Business Day; rendered QA pending. |",
    "END-015": "| END-015 | No Profit/Margin/COGS in worker closing summary. | End Day / Reconciliation | `EndDayFlow.tsx` | — | Source review / production build | PASS | Worker closing summary exposes Recognized Sales, Total Expenses and reconciliation lines only; no Profit, Margin or COGS fields exist. |",
    "END-016": "| END-016 | Closed Business Day cannot be reopened from Operations. | End Day / Reconciliation | `OperationsEndDayService`; `TuxEndDayApi`; `App.tsx` | CLOSED Business Day terminal in Operations | API/source review + Business Day domain tests | PASS | Operations exposes no Reopen Day command; an already-closed day is only recognized as an idempotent close replay. |",
    "END-017": "| END-017 | End Day works offline. | End Day / Reconciliation | `OperationsEndDayService` | Local SQLite/IndexedDB + durable outbox | End Day SQLite integration tests | PASS | End Day has no network dependency; all successful close effects are committed locally. |",
    "END-018": "| END-018 | Cloud failure does not block close. | End Day / Reconciliation | `OperationsEndDayService` | Durable outbox only | Architecture/source review + SQLite tests | PASS | Close performs no remote call and commits pending outbox facts locally, so cloud unavailability is outside the close success path. |",
    "END-019": "| END-019 | Local durable save failure blocks close. | End Day / Reconciliation | `OperationsEndDayService.closeDay` | One local transaction | Injected outbox-failure SQLite integration test | PASS | Forced local outbox failure rolls back reconciliation, session end, Business Day close and close audit, leaving the day OPEN. |",
    "END-020": "| END-020 | Close is idempotent. | End Day / Reconciliation | `OperationsEndDayService.closeDay` | Closed Business Day identity + unique close facts | End Day SQLite replay test | PASS | Repeated close of the same already-closed Business Day returns `replayed=true` with no duplicate reconciliation or close outbox fact. |",
    "END-021": "| END-021 | No automatic End Day PDF. | End Day / Reconciliation | `OperationsEndDayService`; `EndDayFlow.tsx` | — | Source review / production build | PASS | End Day contains no PDF generation dependency or automatic export path. |",
    "END-022": "| END-022 | No automatic End Day print. | End Day / Reconciliation | `OperationsEndDayService`; `EndDayFlow.tsx` | — | Source review / production build | PASS | End Day never invokes the receipt printer or any closing print adapter. |",
    "END-023": "| END-023 | Reports/export/print move to Admin Reports. | End Day / Reconciliation | Operations intentionally exposes no Reports/export/closing-print feature | Future TUX Admin | — | NOT_STARTED | This is future separate TUX Admin scope. Operations preserves the required historical data but does not implement Admin Reports here. |",
    "END-024": "| END-024 | After close, Current Operator session ends. | End Day / Reconciliation | `OperationsEndDayService.closeDay` | Worker Session `endedAt` | End Day SQLite integration test | PASS | Successful close writes `endedAt` for the current Worker Session in the same local transaction. |",
    "END-025": "| END-025 | App returns to No Active Business Day screen. | End Day / Reconciliation | `App.tsx` `refreshAfterEndDay`; session service | No open Business Day after close | End Day SQLite test + production build | IMPLEMENTED_NOT_VALIDATED | Backend proves no open day remains and App refreshes session state to the existing no-active-day screen; rendered transition QA pending. |",
    "END-026": "| END-026 | No automatic next Business Day. | End Day / Reconciliation | `OperationsEndDayService.closeDay` | No new Business Day write | End Day SQLite integration test | PASS | Successful close leaves `getOpenForShop` null; no next Business Day is created by End Day. |",
    "END-027": "| END-027 | Next Business Day order display number starts at #1. | End Day / Reconciliation | Business Day domain allocation | New Business Day counter starts at zero | End Day SQLite/domain test | PASS | Test creates the later Business Day explicitly and proves its first allocated display number is #1. |",
    "END-028": "| END-028 | Bulk Stock carries forward unchanged except for recorded movements. | End Day / Reconciliation | `OperationsEndDayService`; append-only Bulk Stock ledger | Inventory movement history | End Day SQLite integration test | PASS | Inventory movement row count remains unchanged by End Day, so the physical Bulk Stock balance carries forward from its durable ledger. |",
}

out = []
seen = set()
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
    raise SystemExit(f"Missing End Day compliance rows: {sorted(missing)}")
matrix.write_text("\n".join(out) + "\n")
