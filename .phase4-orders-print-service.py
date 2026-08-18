from pathlib import Path

path = Path('packages/application/src/orders.ts')
text = path.read_text()

replacements = [
    (
        "import type { ApplicationError } from './errors';\n",
        "import type { ApplicationError } from './errors';\nimport { unavailableOrderPrinter, type OrderPrinter } from './orderPrinter';\n",
    ),
    (
        "  readonly #runtime: OrdersRuntime;\n  readonly #coordinator: ApplicationCommandCoordinator;\n",
        "  readonly #runtime: OrdersRuntime;\n  readonly #coordinator: ApplicationCommandCoordinator;\n  readonly #printer: OrderPrinter;\n",
    ),
    (
        "    runtime: OrdersRuntime,\n    coordinator = new ApplicationCommandCoordinator(),\n  ) {\n",
        "    runtime: OrdersRuntime,\n    coordinator = new ApplicationCommandCoordinator(),\n    printer: OrderPrinter = unavailableOrderPrinter,\n  ) {\n",
    ),
    (
        "    this.#runtime = runtime;\n    this.#coordinator = coordinator;\n  }\n",
        "    this.#runtime = runtime;\n    this.#coordinator = coordinator;\n    this.#printer = printer;\n  }\n",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'missing replacement marker: {old!r}')
    text = text.replace(old, new, 1)

reset_marker = "        const reset = await this.#resetDraftAfterCommit(draft, context.configuration, warnings);\n"
print_block = """        if (!commitResult.replayed) {
          try {
            const printed = await this.#printer.print(commitResult.order);
            if (!printed.ok) {
              warnings.push('PRINT_FAILED');
            }
          } catch {
            warnings.push('PRINT_FAILED');
          }
        } else {
          warnings.push('PRINT_STATUS_UNKNOWN');
        }

        const reset = await this.#resetDraftAfterCommit(draft, context.configuration, warnings);
"""
if reset_marker not in text:
    raise SystemExit('missing print insertion marker')
text = text.replace(reset_marker, print_block, 1)

recover_marker = "  async #recoverCommittedDraft(draft: OrderDraft, order: OrderSnapshot): Promise<OrderPlacement> {\n"
reprint_method = """  async reprintOrder(orderId: OrderId): Promise<Result<OrderSnapshot, ApplicationError>> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const order = await this.#database.transaction((transaction) =>
          transaction.orders.getById(orderId),
        );
        if (order === null) {
          return err({ code: 'NOT_FOUND', message: 'The saved order could not be found.' });
        }

        const printed = await this.#printer.print(order);
        if (!printed.ok) {
          return err({ code: 'PRINT_ERROR', message: printed.message });
        }
        return ok(order);
      } catch (cause) {
        return err({
          code: 'PRINT_ERROR',
          message: 'The saved order is intact, but the receipt could not be printed.',
          cause,
        });
      }
    });
  }

"""
if recover_marker not in text:
    raise SystemExit('missing reprint insertion marker')
text = text.replace(recover_marker, reprint_method + recover_marker, 1)

replay_reset = "    const reset = await this.#resetDraftAfterCommit(draft, configuration, []);\n"
replay_replacement = """    const reset = await this.#resetDraftAfterCommit(draft, configuration, [
      'PRINT_STATUS_UNKNOWN',
    ]);
"""
if replay_reset not in text:
    raise SystemExit('missing replay print-status marker')
text = text.replace(replay_reset, replay_replacement, 1)

path.write_text(text)
