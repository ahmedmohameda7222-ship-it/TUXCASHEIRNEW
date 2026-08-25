from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'{label} anchor missing in {path}')
    file.write_text(text.replace(old, new, 1))


# ProductCustomizer: add EXTRAS focus target and focus the existing Extras section.
path = 'apps/operations/src/app/ProductCustomizer.tsx'
replace_once(
    path,
    "import { useMemo, useState } from 'react';",
    "import { useEffect, useMemo, useRef, useState } from 'react';",
    'customizer react import',
)
replace_once(
    path,
    "export type ProductCustomizerTarget =\n  | { readonly kind: 'ADD'; readonly productId: ProductId }\n  | { readonly kind: 'EDIT'; readonly lineId: DraftLineId };",
    "export type ProductCustomizerTarget =\n  | {\n      readonly kind: 'ADD';\n      readonly productId: ProductId;\n      readonly focusSection?: 'FULL' | 'EXTRAS';\n    }\n  | {\n      readonly kind: 'EDIT';\n      readonly lineId: DraftLineId;\n      readonly focusSection?: 'FULL' | 'EXTRAS';\n    };",
    'customizer target type',
)
replace_once(
    path,
    "  const [note, setNote] = useState(line?.itemNote ?? '');\n  const [error, setError] = useState<string | null>(null);\n\n  if (product === null) {",
    "  const [note, setNote] = useState(line?.itemNote ?? '');\n  const [error, setError] = useState<string | null>(null);\n  const extrasSectionRef = useRef<HTMLElement>(null);\n\n  useEffect(() => {\n    if (target.focusSection !== 'EXTRAS' || modifierOptions.length === 0) return;\n    const frame = window.requestAnimationFrame(() => {\n      extrasSectionRef.current?.scrollIntoView({ block: 'center' });\n      extrasSectionRef.current?.focus({ preventScroll: true });\n    });\n    return () => window.cancelAnimationFrame(frame);\n  }, [modifierOptions.length, target.focusSection]);\n\n  if (product === null) {",
    'customizer extras focus effect',
)
replace_once(
    path,
    "            <section className=\"customizer-section\" aria-labelledby=\"extras-title\">",
    "            <section\n              ref={extrasSectionRef}\n              className=\"customizer-section\"\n              aria-labelledby=\"extras-title\"\n              tabIndex={-1}\n            >",
    'customizer extras section',
)

# Product card: contextual Extra entry and aggregate badge.
path = 'apps/operations/src/app/MenuProductCard.tsx'
replace_once(
    path,
    "import { formatMoneyMinor } from './ordersView';",
    "import { PlusCircleIcon } from './icons';\nimport { formatMoneyMinor } from './ordersView';",
    'product card icon import',
)
replace_once(
    path,
    "  quantity,\n  busy,\n  onQuickInfo,\n  onDecrement,\n  onAdd,",
    "  quantity,\n  supportsExtras,\n  busy,\n  onQuickInfo,\n  onDecrement,\n  onAdd,\n  onExtras,",
    'product card props destructure',
)
replace_once(
    path,
    "  readonly quantity: number;\n  readonly busy: boolean;\n  readonly onQuickInfo: () => void;\n  readonly onDecrement: () => void;\n  readonly onAdd: () => void;",
    "  readonly quantity: number;\n  readonly supportsExtras: boolean;\n  readonly busy: boolean;\n  readonly onQuickInfo: () => void;\n  readonly onDecrement: () => void;\n  readonly onAdd: () => void;\n  readonly onExtras: () => void;",
    'product card props type',
)
replace_once(
    path,
    "        <div className=\"product-media\">\n          <ProductMedia product={product} />\n        </div>",
    "        <div className=\"product-media\">\n          <ProductMedia product={product} />\n          {quantity > 0 ? (\n            <span className=\"product-quantity-badge\" aria-label={`${quantity} in current order`}>\n              {quantity}\n            </span>\n          ) : null}\n        </div>",
    'product card quantity badge',
)
replace_once(
    path,
    "      <footer className=\"product-card-footer\">\n        <strong className=\"product-price\">{formatMoneyMinor(product.priceMinor)}</strong>\n        <div className=\"product-quantity\" aria-label={`${product.name} quantity`}>\n          <button\n            type=\"button\"\n            aria-label={`Remove one ${product.name}`}\n            disabled={busy || quantity === 0}\n            onClick={(event) => runIndependentAction(event, onDecrement)}\n          >\n            −\n          </button>\n          <output>{quantity}</output>\n          <button\n            type=\"button\"\n            aria-label={`Add one ${product.name}`}\n            disabled={busy || product.soldOut}\n            onClick={(event) => runIndependentAction(event, onAdd)}\n          >\n            +\n          </button>\n        </div>\n      </footer>",
    "      <footer className=\"product-card-footer\">\n        <strong className=\"product-price\">{formatMoneyMinor(product.priceMinor)}</strong>\n        <div className=\"product-card-controls\">\n          {supportsExtras && !product.soldOut ? (\n            <button\n              type=\"button\"\n              className=\"product-extra-action\"\n              disabled={busy}\n              onClick={(event) => runIndependentAction(event, onExtras)}\n            >\n              <PlusCircleIcon />\n              <span>Extra</span>\n            </button>\n          ) : null}\n          <div className=\"product-quantity\" aria-label={`${product.name} quantity`}>\n            <button\n              type=\"button\"\n              aria-label={`Remove one ${product.name}`}\n              disabled={busy || quantity === 0}\n              onClick={(event) => runIndependentAction(event, onDecrement)}\n            >\n              −\n            </button>\n            <output>{quantity}</output>\n            <button\n              type=\"button\"\n              aria-label={`Add one ${product.name}`}\n              disabled={busy || product.soldOut}\n              onClick={(event) => runIndependentAction(event, onAdd)}\n            >\n              +\n            </button>\n          </div>\n        </div>\n      </footer>",
    'product card footer controls',
)

# Workspace: determine active Extras support and route both entry points into the same customizer.
path = 'apps/operations/src/app/OrdersWorkspace.tsx'
replace_once(
    path,
    "  const configuredActiveCategories = useMemo(\n    () =>\n      configuration?.categories\n        .filter((category) => category.active)\n        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],\n    [configuration],\n  );",
    "  const configuredActiveCategories = useMemo(\n    () =>\n      configuration?.categories\n        .filter((category) => category.active)\n        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],\n    [configuration],\n  );\n  const productsWithExtras = useMemo(() => {\n    if (configuration === null) return new Set<ProductId>();\n    const activeModifierIds = new Set(\n      configuration.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id),\n    );\n    return new Set(\n      configuration.productModifierLinks\n        .filter((link) => activeModifierIds.has(link.modifierId))\n        .map((link) => link.productId),\n    );\n  }, [configuration]);",
    'workspace extras support set',
)
replace_once(
    path,
    "                quantity={productQuantityInDraft(draft, product.id)}\n                busy={busy}\n                onQuickInfo={() => setQuickInfoProductId(product.id)}\n                onDecrement={() => decrementProduct(product)}\n                onAdd={() => addProduct(product)}",
    "                quantity={productQuantityInDraft(draft, product.id)}\n                supportsExtras={productsWithExtras.has(product.id)}\n                busy={busy}\n                onQuickInfo={() => setQuickInfoProductId(product.id)}\n                onDecrement={() => decrementProduct(product)}\n                onAdd={() => addProduct(product)}\n                onExtras={() =>\n                  setCustomizer({ kind: 'ADD', productId: product.id, focusSection: 'EXTRAS' })\n                }",
    'workspace product card extras props',
)
replace_once(
    path,
    "          onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}\n          onDecrementLine={decrementLine}",
    "          onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}\n          onEditLineExtras={(lineId) =>\n            setCustomizer({ kind: 'EDIT', lineId, focusSection: 'EXTRAS' })\n          }\n          onDecrementLine={decrementLine}",
    'workspace desktop cart extras callback',
)
replace_once(
    path,
    "            onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}\n            onDecrementLine={decrementLine}",
    "            onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}\n            onEditLineExtras={(lineId) =>\n              setCustomizer({ kind: 'EDIT', lineId, focusSection: 'EXTRAS' })\n            }\n            onDecrementLine={decrementLine}",
    'workspace mobile cart extras callback',
)
replace_once(
    path,
    "          key={\n            customizer.kind === 'ADD' ? `add:${customizer.productId}` : `edit:${customizer.lineId}`\n          }",
    "          key={\n            customizer.kind === 'ADD'\n              ? `add:${customizer.productId}:${customizer.focusSection ?? 'FULL'}`\n              : `edit:${customizer.lineId}:${customizer.focusSection ?? 'FULL'}`\n          }",
    'workspace customizer key',
)
replace_once(
    path,
    "          canCustomize={\n            quickInfoProduct.isCombo ||\n            configuration.productModifierLinks.some(\n              (link) => link.productId === quickInfoProduct.id,\n            )\n          }",
    "          canCustomize={quickInfoProduct.isCombo || productsWithExtras.has(quickInfoProduct.id)}",
    'workspace quick info active extras',
)

# Cart: contextual Extra shortcut edits the same existing draft line.
path = 'apps/operations/src/app/OrdersCart.tsx'
replace_once(
    path,
    "import { MoneyInput } from './MoneyInput';",
    "import { EditPencilIcon, PlusCircleIcon } from './icons';\nimport { MoneyInput } from './MoneyInput';",
    'cart icon import',
)
replace_once(
    path,
    "  onMutate,\n  onEditLine,\n  onDecrementLine,",
    "  onMutate,\n  onEditLine,\n  onEditLineExtras,\n  onDecrementLine,",
    'cart extras callback destructure',
)
replace_once(
    path,
    "  readonly onMutate: (mutation: DraftMutation) => void;\n  readonly onEditLine: (lineId: DraftLineId) => void;\n  readonly onDecrementLine: (lineId: DraftLineId) => void;",
    "  readonly onMutate: (mutation: DraftMutation) => void;\n  readonly onEditLine: (lineId: DraftLineId) => void;\n  readonly onEditLineExtras: (lineId: DraftLineId) => void;\n  readonly onDecrementLine: (lineId: DraftLineId) => void;",
    'cart extras callback type',
)
replace_once(
    path,
    "  const methods = activePaymentMethods(configuration);\n  const itemsSubtotalMinor = useMemo(",
    "  const methods = activePaymentMethods(configuration);\n  const productsWithExtras = useMemo(() => {\n    const activeModifierIds = new Set(\n      configuration.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id),\n    );\n    return new Set(\n      configuration.productModifierLinks\n        .filter((link) => activeModifierIds.has(link.modifierId))\n        .map((link) => link.productId),\n    );\n  }, [configuration.modifiers, configuration.productModifierLinks]);\n  const itemsSubtotalMinor = useMemo(",
    'cart extras support set',
)
replace_once(
    path,
    "              {draft.lines.map((line) => {\n                const lineIssues = issues.filter((issue) => issue.path === `line:${line.id}`);\n                return (",
    "              {draft.lines.map((line) => {\n                const lineIssues = issues.filter((issue) => issue.path === `line:${line.id}`);\n                const supportsExtras = productsWithExtras.has(line.productId);\n                return (",
    'cart per-line extras support',
)
replace_once(
    path,
    "                    <div className=\"line-actions\">\n                      <button type=\"button\" disabled={busy} onClick={() => onEditLine(line.id)}>\n                        Edit\n                      </button>",
    "                    <div className=\"line-actions\">\n                      {supportsExtras ? (\n                        <button\n                          type=\"button\"\n                          className=\"line-extra-action\"\n                          disabled={busy}\n                          onClick={() => onEditLineExtras(line.id)}\n                        >\n                          {line.modifiers.length > 0 ? <EditPencilIcon /> : <PlusCircleIcon />}\n                          <span>Extra</span>\n                        </button>\n                      ) : null}\n                      <button type=\"button\" disabled={busy} onClick={() => onEditLine(line.id)}>\n                        Edit\n                      </button>",
    'cart line extra action',
)

# Styling: restrained badge and shortcut controls; preserve existing premium layout.
path = 'apps/operations/src/styles/orders.css'
replace_once(
    path,
    ".product-media {\n  width: 5.4rem;",
    ".product-media {\n  position: relative;\n  width: 5.4rem;",
    'orders product media positioning',
)
replace_once(
    path,
    ".product-quantity,\n.quantity-control {",
    ".product-quantity-badge {\n  position: absolute;\n  top: var(--tux-space-1);\n  right: var(--tux-space-1);\n  display: grid;\n  min-width: 1.45rem;\n  height: 1.45rem;\n  place-items: center;\n  border: 2px solid var(--tux-surface-raised);\n  border-radius: 999px;\n  background: var(--tux-accent-strong);\n  color: var(--tux-action-foreground);\n  padding: 0 0.3rem;\n  font-size: 0.7rem;\n  font-weight: 800;\n  font-variant-numeric: tabular-nums;\n  line-height: 1;\n  pointer-events: none;\n}\n\n.product-card-controls {\n  display: flex;\n  min-width: 0;\n  align-items: center;\n  justify-content: flex-end;\n  gap: var(--tux-space-1);\n  flex-wrap: wrap;\n}\n\n.product-extra-action {\n  display: inline-flex;\n  min-height: var(--tux-touch-target);\n  align-items: center;\n  gap: 0.35rem;\n  border: 1px solid var(--tux-border-subtle);\n  border-radius: var(--tux-radius-sm);\n  background: transparent;\n  color: var(--tux-accent-strong);\n  padding: 0 var(--tux-space-2);\n  font-size: var(--tux-font-size-xs);\n  font-weight: 700;\n}\n\n.product-extra-action:hover:not(:disabled) {\n  background: var(--tux-accent-hover-soft);\n}\n\n.product-extra-action svg,\n.line-extra-action svg {\n  width: 1.05rem;\n  height: 1.05rem;\n  flex: 0 0 auto;\n}\n\n.line-extra-action {\n  display: inline-flex;\n  align-items: center;\n  gap: 0.35rem;\n}\n\n.product-quantity,\n.quantity-control {",
    'orders extras controls styles',
)
