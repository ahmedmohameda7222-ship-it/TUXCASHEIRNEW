from pathlib import Path

cart_path = Path('apps/operations/src/app/OrdersCart.tsx')
cart = cart_path.read_text()

replacements = [
    (
        "import { MoneyInput } from './MoneyInput';",
        "import { MoneyInput, OptionalMoneyInput } from './MoneyInput';",
    ),
    (
        "    () => suggestCashTenders(allocatedMinor).slice(0, 4),",
        "    () => suggestCashTenders(allocatedMinor),",
    ),
    (
        "  readonly onCommit: (value: MoneyMinor) => void;\n}) {",
        "  readonly onCommit: (value: MoneyMinor | null) => void;\n}) {",
    ),
    (
        "      <MoneyInput\n        id={`${idPrefix}-cash-received`}\n        label={label}\n        value={receivedMinor ?? ZERO_MONEY}\n        disabled={busy}\n        compact\n        onCommit={onCommit}\n      />",
        "      <OptionalMoneyInput\n        id={`${idPrefix}-cash-received`}\n        label={label}\n        value={receivedMinor}\n        disabled={busy}\n        compact\n        onCommit={onCommit}\n      />",
    ),
    (
        "        methodAId: methodA.id,\n        amountAMinor: ZERO_MONEY,\n        methodACashReceivedMinor: null,\n        methodBId: methodB.id,\n        methodBCashReceivedMinor: null,",
        "        methodAId: methodA.id,\n        amountAMinor: ZERO_MONEY,\n        methodBId: methodB.id,",
    ),
]
for old, new in replacements:
    if old not in cart:
        raise SystemExit(f'Missing OrdersCart anchor: {old[:80]}')
    cart = cart.replace(old, new, 1)

cart_path.write_text(cart)

css_path = Path('apps/operations/src/styles/orders.css')
css = css_path.read_text()
old_css = '''.change-row,
.split-remainder {
  padding: var(--tux-space-2) var(--tux-space-3);
  border-radius: var(--tux-radius-sm);
  background: color-mix(in srgb, var(--tux-positive) 8%, var(--tux-surface-raised));
}

.change-row strong,
.split-remainder strong {
  font-size: var(--tux-font-size-sm);
}
'''
new_css = '''.change-row {
  padding: var(--tux-space-2) var(--tux-space-3);
  border-radius: var(--tux-radius-sm);
  background: color-mix(in srgb, var(--tux-positive) 8%, var(--tux-surface-raised));
}

.change-row strong {
  font-size: var(--tux-font-size-sm);
}

.split-remainder {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tux-space-3);
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.payment-section .field-stack > span,
.payment-section .money-field > label,
.payment-section .split-remainder > span {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0;
}

.payment-section select,
.payment-section .money-input-wrap input,
.payment-section .split-remainder > strong {
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
}

.split-method-block {
  padding: 0;
  border: 0;
  background: transparent;
}
'''
if old_css not in css:
    raise SystemExit('Missing payment CSS anchor')
css = css.replace(old_css, new_css, 1)
css = css.replace('  min-height: 2.2rem;\n  border-color: var(--tux-border-subtle);', '  min-height: var(--tux-touch-target);\n  border-color: var(--tux-border-subtle);', 1)
css_path.write_text(css)

e2e_path = Path('e2e/operations.e2e.ts')
e2e = e2e_path.read_text()
e2e = e2e.replace("test('Cash entry stays optional and split stays allocation-only'", "test('cash entry stays optional and split stays allocation-only'", 1)
stale = "  await cart.getByLabel('Cash received A').fill('50');\n  await cart.getByLabel('Cash received A').blur();\n"
if stale not in e2e:
    raise SystemExit('Missing stale split tender E2E helper anchor')
e2e = e2e.replace(stale, '', 1)
e2e_path.write_text(e2e)
