from pathlib import Path

workspace = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = workspace.read_text()

text = text.replace(
    "  type OrderDraft,\n  type OrderValidationIssue,\n",
    "  type OrderDraft,\n  type OrderId,\n  type OrderValidationIssue,\n",
    1,
)

undo_marker = """interface UndoState {
  readonly snapshot: OrderDraft;
  readonly message: string;
}
"""
print_interface = """interface UndoState {
  readonly snapshot: OrderDraft;
  readonly message: string;
}

interface PrintNoticeState {
  readonly orderId: OrderId;
  readonly displayOrderNo: number;
  readonly kind: 'FAILED' | 'UNKNOWN';
  readonly message: string;
}
"""
if undo_marker not in text:
    raise SystemExit('missing UndoState marker')
text = text.replace(undo_marker, print_interface, 1)

state_marker = """  const [placing, setPlacing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
"""
state_replacement = """  const [placing, setPlacing] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<PrintNoticeState | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
"""
if state_marker not in text:
    raise SystemExit('missing state marker')
text = text.replace(state_marker, state_replacement, 1)

place_tail = """    const prefix = result.value.replayed ? 'Recovered' : 'Placed';
    setSuccessMessage(`${prefix} order #${result.value.order.displayOrderNo}`);
    window.setTimeout(() => setSuccessMessage(null), 4_500);
    if (result.value.postCommitWarnings.length > 0) {
      setGlobalError(
        `Order saved locally. Follow-up warning: ${result.value.postCommitWarnings.join(', ')}`,
      );
    }
  }

  if (loading) {
"""
place_replacement = """    const prefix = result.value.replayed ? 'Recovered' : 'Placed';
    setSuccessMessage(`${prefix} order #${result.value.order.displayOrderNo}`);
    window.setTimeout(() => setSuccessMessage(null), 4_500);

    const printFailed = result.value.postCommitWarnings.includes('PRINT_FAILED');
    const printUnknown = result.value.postCommitWarnings.includes('PRINT_STATUS_UNKNOWN');
    if (printFailed || printUnknown) {
      setPrintNotice({
        orderId: result.value.order.id,
        displayOrderNo: result.value.order.displayOrderNo,
        kind: printFailed ? 'FAILED' : 'UNKNOWN',
        message: printFailed
          ? 'The order is saved locally, but the receipt did not print.'
          : 'The order was recovered safely. Receipt print status is unknown, so it was not printed again automatically.',
      });
    } else {
      setPrintNotice(null);
    }

    const otherWarnings = result.value.postCommitWarnings.filter(
      (warning) => warning !== 'PRINT_FAILED' && warning !== 'PRINT_STATUS_UNKNOWN',
    );
    if (otherWarnings.length > 0) {
      setGlobalError(
        `Order #${result.value.order.displayOrderNo} is saved locally. Follow-up issue: ${otherWarnings.join(', ')}`,
      );
    }
  }

  async function reprintReceipt(): Promise<void> {
    const notice = printNotice;
    if (notice === null || reprinting) return;

    setReprinting(true);
    const result = await client.reprintOrder(notice.orderId);
    setReprinting(false);
    if (!result.ok) {
      setPrintNotice({
        ...notice,
        kind: 'FAILED',
        message: `Order #${notice.displayOrderNo} is still saved locally. ${result.error.message}`,
      });
      return;
    }

    setPrintNotice(null);
    setSuccessMessage(`Receipt reprinted for order #${result.value.displayOrderNo}`);
    window.setTimeout(() => setSuccessMessage(null), 4_500);
  }

  if (loading) {
"""
if place_tail not in text:
    raise SystemExit('missing placeOrder tail marker')
text = text.replace(place_tail, place_replacement, 1)

busy_marker = "  const busy = saving || placing;\n"
if busy_marker not in text:
    raise SystemExit('missing busy marker')
text = text.replace(busy_marker, "  const busy = saving || placing;\n", 1)

render_marker = """      {successMessage === null ? null : (
        <div className="success-toast" role="status">
          {successMessage}
        </div>
      )}
      {globalError === null ? null : (
"""
render_replacement = """      {successMessage === null ? null : (
        <div className="success-toast" role="status">
          {successMessage}
        </div>
      )}
      {printNotice === null ? null : (
        <div className="print-notice" role="status">
          <div>
            <strong>Order #{printNotice.displayOrderNo} saved locally</strong>
            <span>{printNotice.message}</span>
          </div>
          <div className="print-notice-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={reprinting}
              onClick={() => void reprintReceipt()}
            >
              {reprinting ? 'Printing…' : printNotice.kind === 'FAILED' ? 'Retry print' : 'Reprint receipt'}
            </button>
            <button
              type="button"
              className="quiet-action"
              disabled={reprinting}
              onClick={() => setPrintNotice(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {globalError === null ? null : (
"""
if render_marker not in text:
    raise SystemExit('missing success/global error render marker')
text = text.replace(render_marker, render_replacement, 1)
workspace.write_text(text)

css = Path('apps/operations/src/styles/orders.css')
css_text = css.read_text()
if '.print-notice {' not in css_text:
    css_text += """

.print-notice {
  position: fixed;
  right: var(--tux-space-5);
  bottom: var(--tux-space-5);
  z-index: var(--tux-z-toast);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--tux-space-4);
  width: min(calc(100% - 2rem), 34rem);
  padding: var(--tux-space-4);
  border: 1px solid var(--tux-warning);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-raised);
  box-shadow: var(--tux-shadow-sm);
}

.print-notice > div:first-child {
  display: grid;
  gap: var(--tux-space-1);
}

.print-notice strong {
  font-size: var(--tux-font-size-sm);
}

.print-notice span {
  color: var(--tux-text-secondary);
  font-size: var(--tux-font-size-xs);
  line-height: 1.45;
}

.print-notice-actions {
  display: flex;
  align-items: center;
  gap: var(--tux-space-2);
}

.print-notice-actions .secondary-action,
.print-notice-actions .quiet-action {
  margin: 0;
  white-space: nowrap;
}

@media (max-width: 34rem) {
  .print-notice {
    right: var(--tux-space-3);
    bottom: var(--tux-space-3);
    left: var(--tux-space-3);
    grid-template-columns: 1fr;
    width: auto;
  }

  .print-notice-actions {
    justify-content: flex-end;
  }
}
"""
css.write_text(css_text)
