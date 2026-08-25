from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'{label} anchor missing in {path}')
    file.write_text(text.replace(old, new, 1))


# Workspace: duplicate the exact configured line for +1 and preserve existing decrement undo behavior.
path = 'apps/operations/src/app/OrdersWorkspace.tsx'
replace_once(
    path,
    "  decrementDraftLine,\n  decrementProductUnit,",
    "  decrementDraftLine,\n  decrementProductUnit,\n  duplicateDraftLineUnit,",
    'workspace duplicate import',
)
replace_once(
    path,
    "  function decrementLine(lineId: DraftLineId): void {\n    const current = draftRef.current;\n    const line = current?.lines.find((candidate) => candidate.id === lineId);\n    if (current === null || line === undefined) return;\n    showUndo(current, `Removed one ${line.productName}`);\n    enqueueMutation((candidate) => decrementDraftLine(candidate, lineId));\n  }\n\n  function submitCustomization",
    "  function decrementLine(lineId: DraftLineId): void {\n    const current = draftRef.current;\n    const line = current?.lines.find((candidate) => candidate.id === lineId);\n    if (current === null || line === undefined) return;\n    showUndo(current, `Removed one ${line.productName}`);\n    enqueueMutation((candidate) => decrementDraftLine(candidate, lineId));\n  }\n\n  function incrementLine(lineId: DraftLineId): void {\n    if (draftRef.current === null || configuration === null) return;\n    enqueueMutation((current) =>\n      duplicateDraftLineUnit({\n        draft: current,\n        configuration,\n        lineId,\n        newLineId: parseEntityId<DraftLineId>(crypto.randomUUID()),\n        addedSequence: nextDraftAddedSequence(current),\n      }),\n    );\n  }\n\n  function submitCustomization",
    'workspace increment function',
)
replace_once(
    path,
    "          onDecrementLine={decrementLine}\n          onClear=",
    "          onDecrementLine={decrementLine}\n          onIncrementLine={incrementLine}\n          onClear=",
    'workspace desktop increment callback',
)
replace_once(
    path,
    "            onDecrementLine={decrementLine}\n            onClear=",
    "            onDecrementLine={decrementLine}\n            onIncrementLine={incrementLine}\n            onClear=",
    'workspace mobile increment callback',
)

# Cart: add increment callback, cashier-first section ordering, line controls, and heading hierarchy.
path = 'apps/operations/src/app/OrdersCart.tsx'
text = Path(path).read_text()
text = text.replace(
    "  onEditLineExtras,\n  onDecrementLine,\n  onClear,",
    "  onEditLineExtras,\n  onDecrementLine,\n  onIncrementLine,\n  onClear,",
    1,
)
text = text.replace(
    "  readonly onEditLineExtras: (lineId: DraftLineId) => void;\n  readonly onDecrementLine: (lineId: DraftLineId) => void;\n  readonly onClear: () => void;",
    "  readonly onEditLineExtras: (lineId: DraftLineId) => void;\n  readonly onDecrementLine: (lineId: DraftLineId) => void;\n  readonly onIncrementLine: (lineId: DraftLineId) => void;\n  readonly onClear: () => void;",
    1,
)
old_heading = """      <div className=\"cart-heading\">\n        <div>\n          <span>Current order</span>\n          <strong>\n            {totalQuantity === 0\n              ? 'Empty'\n              : `${totalQuantity} item${totalQuantity === 1 ? '' : 's'}`}\n          </strong>\n        </div>"""
new_heading = """      <div className=\"cart-heading\">\n        <div>\n          <strong className=\"cart-title\">Current Order</strong>\n          <span className=\"cart-count\">\n            {totalQuantity === 0\n              ? 'Empty'\n              : `${totalQuantity} item${totalQuantity === 1 ? '' : 's'}`}\n          </span>\n        </div>"""
if old_heading not in text:
    raise SystemExit('cart heading anchor missing')
text = text.replace(old_heading, new_heading, 1)

# Swap the two initial sections without touching their contents.
order_start = text.find('        <section\n          className="cart-section order-type-section"')
items_start = text.find('        <section\n          className="cart-section cart-lines-section"')
after_items = text.find('\n\n        {delivery ? (', items_start)
if min(order_start, items_start, after_items) < 0 or not (order_start < items_start < after_items):
    raise SystemExit('cart section ordering anchors missing')
order_chunk = text[order_start:items_start].rstrip()
items_chunk = text[items_start:after_items].rstrip()
text = text[:order_start] + items_chunk + '\n\n' + order_chunk + text[after_items:]

old_actions = """                    <div className=\"line-actions\">\n                      {supportsExtras ? (\n                        <button\n                          type=\"button\"\n                          className=\"line-extra-action\"\n                          disabled={busy}\n                          onClick={() => onEditLineExtras(line.id)}\n                        >\n                          {line.modifiers.length > 0 ? <EditPencilIcon /> : <PlusCircleIcon />}\n                          <span>Extra</span>\n                        </button>\n                      ) : null}\n                      <button type=\"button\" disabled={busy} onClick={() => onEditLine(line.id)}>\n                        Edit\n                      </button>\n                      <button\n                        type=\"button\"\n                        disabled={busy}\n                        onClick={() => onDecrementLine(line.id)}\n                      >\n                        − One\n                      </button>\n                    </div>"""
new_actions = """                    <div className=\"line-actions\" aria-label={`${line.productName} actions`}>\n                      <button\n                        type=\"button\"\n                        disabled={busy}\n                        onClick={() => onDecrementLine(line.id)}\n                      >\n                        −1\n                      </button>\n                      <button\n                        type=\"button\"\n                        disabled={busy}\n                        onClick={() => onIncrementLine(line.id)}\n                      >\n                        +1\n                      </button>\n                      <button type=\"button\" disabled={busy} onClick={() => onEditLine(line.id)}>\n                        Edit\n                      </button>\n                      {supportsExtras ? (\n                        <button\n                          type=\"button\"\n                          className=\"line-extra-action\"\n                          disabled={busy}\n                          onClick={() => onEditLineExtras(line.id)}\n                        >\n                          {line.modifiers.length > 0 ? <EditPencilIcon /> : <PlusCircleIcon />}\n                          <span>Extra</span>\n                        </button>\n                      ) : null}\n                    </div>"""
if old_actions not in text:
    raise SystemExit('cart line actions anchor missing')
text = text.replace(old_actions, new_actions, 1)
Path(path).write_text(text)

# Cart geometry and exact Task 11 heading sizes.
path = 'apps/operations/src/styles/orders.css'
replace_once(
    path,
    ".orders-cart {\n  display: flex;\n  height: 100%;\n  min-height: 0;\n  flex-direction: column;\n  background: var(--tux-surface-panel);\n}",
    ".orders-cart {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr) auto;\n  height: 100%;\n  min-height: 0;\n  background: var(--tux-surface-panel);\n}",
    'cart grid shell',
)
replace_once(
    path,
    ".cart-heading span,\n.section-heading-row span,",
    ".cart-count,\n.section-heading-row span,",
    'cart count selector',
)
replace_once(
    path,
    ".cart-heading strong {\n  font-size: var(--tux-font-size-md);\n}\n\n.cart-scroll {\n  min-height: 0;\n  flex: 1;\n  overflow-y: auto;\n}",
    ".cart-title {\n  font-size: 17px;\n  line-height: 22px;\n  font-weight: 600;\n}\n\n.cart-count {\n  font-size: 13px;\n  line-height: 16px;\n  font-weight: 400;\n}\n\n.cart-scroll {\n  min-height: 0;\n  overflow: auto;\n}",
    'cart title and scroll geometry',
)
replace_once(
    path,
    ".line-actions {\n  display: flex;\n  gap: var(--tux-space-1);\n}\n\n.line-actions button {\n  min-height: 2.1rem;\n  padding: 0 var(--tux-space-2);\n  font-size: var(--tux-font-size-xs);\n}",
    ".line-actions {\n  display: inline-flex;\n  width: fit-content;\n  max-width: 100%;\n  gap: 0;\n  overflow-x: auto;\n}\n\n.line-actions button {\n  min-height: var(--tux-touch-target);\n  border-color: var(--tux-border-subtle);\n  border-radius: 0;\n  padding: 0 var(--tux-space-2);\n  font-size: var(--tux-font-size-xs);\n  white-space: nowrap;\n}\n\n.line-actions button + button {\n  margin-left: -1px;\n}\n\n.line-actions button:first-child {\n  border-radius: var(--tux-radius-sm) 0 0 var(--tux-radius-sm);\n}\n\n.line-actions button:last-child {\n  border-radius: 0 var(--tux-radius-sm) var(--tux-radius-sm) 0;\n}",
    'attached line controls',
)
replace_once(
    path,
    ".cart-totals {\n  display: grid;",
    ".cart-totals {\n  position: static;\n  display: grid;",
    'static cart totals',
)
