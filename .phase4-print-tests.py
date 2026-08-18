from pathlib import Path

path = Path('apps/operations-desktop/src/main/orders.integration.test.ts')
text = path.read_text()

text = text.replace(
    "import { OperationsOrdersService } from '@tux/application';\n",
    "import { OperationsOrdersService, type OrderPrinter } from '@tux/application';\n",
    1,
)
text = text.replace(
    "  type OrderDraft,\n  type OrderTypeId,\n",
    "  type OrderDraft,\n  type OrderSnapshot,\n  type OrderTypeId,\n",
    1,
)
text = text.replace(
    "async function fixture(databaseOverride?: (base: SqliteOperationsDatabase) => OperationsDatabase) {\n",
    "async function fixture(\n  databaseOverride?: (base: SqliteOperationsDatabase) => OperationsDatabase,\n  printer?: OrderPrinter,\n) {\n",
    1,
)
service_marker = """  const service = new OperationsOrdersService(serviceDatabase, readModel, draftStore, {
    now: () => now,
    createUuid: () => randomUUID(),
  });
"""
service_replacement = """  const service = new OperationsOrdersService(
    serviceDatabase,
    readModel,
    draftStore,
    {
      now: () => now,
      createUuid: () => randomUUID(),
    },
    undefined,
    printer,
  );
"""
if service_marker not in text:
    raise SystemExit('fixture service marker not found')
text = text.replace(service_marker, service_replacement, 1)

describe_marker = "describe('OperationsOrdersService with SQLite', () => {\n"
printer_class = """class RecordingOrderPrinter implements OrderPrinter {
  readonly orders: OrderSnapshot[] = [];
  fail = false;

  async print(order: OrderSnapshot) {
    this.orders.push(order);
    return this.fail
      ? ({ ok: false, message: 'Injected receipt print failure.' } as const)
      : ({ ok: true } as const);
  }
}

"""
if describe_marker not in text:
    raise SystemExit('describe marker not found')
text = text.replace(describe_marker, printer_class + describe_marker, 1)

closing = "\n});\n"
if not text.endswith(closing):
    raise SystemExit('test file closing marker not found')
new_tests = """

  it('prints a fresh durable order once and never auto-prints an idempotent replay', async () => {
    const printer = new RecordingOrderPrinter();
    const { service } = await fixture(undefined, printer);
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const saved = await saveDraft(
      service,
      withCashPayment(withSingleBurger(workspace.value.draft)),
    );
    const first = await service.placeOrder(saved);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.postCommitWarnings).not.toContain('PRINT_FAILED');
    expect(printer.orders).toHaveLength(1);
    expect(printer.orders[0]?.id).toBe(first.value.order.id);

    const replay = await service.placeOrder(saved);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.error.message);
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.order.id).toBe(first.value.order.id);
    expect(replay.value.postCommitWarnings).toContain('PRINT_STATUS_UNKNOWN');
    expect(printer.orders).toHaveLength(1);
  });

  it('keeps a failed print order durable and reprints without duplicating business effects', async () => {
    const printer = new RecordingOrderPrinter();
    printer.fail = true;
    const { databasePath, service } = await fixture(undefined, printer);
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const saved = await saveDraft(
      service,
      withCashPayment(withSingleBurger(workspace.value.draft)),
    );
    const placed = await service.placeOrder(saved);
    expect(placed.ok).toBe(true);
    if (!placed.ok) throw new Error(placed.error.message);
    expect(placed.value.postCommitWarnings).toContain('PRINT_FAILED');
    expect(printer.orders).toHaveLength(1);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(1);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(1);
    expect(
      scalar(
        databasePath,
        \"SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'\",
      ),
    ).toBe(1);

    const failedRetry = await service.reprintOrder(placed.value.order.id);
    expect(failedRetry.ok).toBe(false);
    if (failedRetry.ok) throw new Error('Expected the injected reprint failure.');
    expect(failedRetry.error.code).toBe('PRINT_ERROR');

    printer.fail = false;
    const successfulRetry = await service.reprintOrder(placed.value.order.id);
    expect(successfulRetry.ok).toBe(true);
    if (!successfulRetry.ok) throw new Error(successfulRetry.error.message);
    expect(successfulRetry.value.id).toBe(placed.value.order.id);
    expect(printer.orders).toHaveLength(3);
    expect(printer.orders.every((order) => order.id === placed.value.order.id)).toBe(true);

    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(1);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(1);
    expect(
      scalar(
        databasePath,
        \"SELECT COUNT(*) AS value FROM audit_events WHERE event_type = 'ORDER_PLACED'\",
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        \"SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'\",
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        'SELECT last_allocated_display_order_no AS value FROM business_days LIMIT 1',
      ),
    ).toBe(1);
  });
"""
text = text[: -len(closing)] + new_tests + closing
path.write_text(text)
