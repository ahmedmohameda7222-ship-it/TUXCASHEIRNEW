from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    target = Path(path)
    text = target.read_text()
    if after in text:
        return
    if before not in text:
        raise SystemExit(f"Expected source block not found in {path}: {before[:100]!r}")
    target.write_text(text.replace(before, after, 1))


global_css = "apps/operations/src/styles/global.css"
premium_css = "apps/operations/src/styles/premium.css"

replace_once(
    global_css,
    """html {\n  font-family:\n    Inter,\n    ui-sans-serif,\n    system-ui,\n    -apple-system,\n    BlinkMacSystemFont,\n    'Segoe UI',\n    sans-serif;\n""",
    """html {\n  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;\n""",
)

replace_once(
    global_css,
    """  grid-template-columns: auto minmax(0, 1fr) auto;\n  align-items: center;\n""",
    """  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);\n  align-items: center;\n""",
)

replace_once(
    global_css,
    """.operations-nav {\n  gap: var(--tux-space-1);\n  min-width: 0;\n}\n""",
    """.operations-brand-slot {\n  justify-self: start;\n}\n\n.operations-nav {\n  justify-self: center;\n  gap: var(--tux-space-1);\n  min-width: 0;\n}\n""",
)

replace_once(
    global_css,
    """.header-actions {\n  gap: var(--tux-space-4);\n}\n""",
    """.header-actions {\n  justify-self: end;\n  gap: var(--tux-space-4);\n}\n""",
)

replace_once(
    global_css,
    """  .operations-nav {\n    grid-column: 1 / -1;\n    grid-row: 2;\n    overflow-x: auto;\n  }\n""",
    """  .operations-nav {\n    grid-column: 1 / -1;\n    grid-row: 2;\n    justify-self: stretch;\n    overflow-x: auto;\n  }\n""",
)

premium = Path(premium_css)
text = premium.read_text()
marker = "/* Task 14: approved POS hierarchy and density. */"
if marker not in text:
    text += r'''

/* Task 14: approved POS hierarchy and density. */
.operations-header {
  padding-inline: 0.7rem;
}

.operations-header .nav-item {
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
}

.operations-header .nav-item-active {
  font-weight: 600;
}

.menu-toolbar {
  gap: var(--tux-space-2);
  margin-bottom: var(--tux-space-1);
  padding-block: 0.25rem;
}

.menu-toolbar .category-rail {
  padding-block: 0;
}

.menu-toolbar .category-rail button {
  min-height: var(--tux-touch-target);
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
}

.menu-toolbar .category-rail button.selected {
  font-weight: 600;
}

.menu-toolbar .product-search {
  gap: 0;
}

.product-card {
  border-color: color-mix(in srgb, var(--tux-border-subtle) 82%, transparent);
}

.product-card:hover {
  border-color: color-mix(in srgb, var(--tux-accent) 20%, var(--tux-border-subtle));
}

.product-card-selected {
  border-color: color-mix(in srgb, var(--tux-accent) 32%, var(--tux-border-subtle));
  background: color-mix(in srgb, var(--tux-accent-soft) 18%, var(--tux-surface-panel));
}

.product-image-fallback {
  color: var(--tux-text-secondary);
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.product-copy strong {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.product-copy p {
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
}

.product-card-footer {
  border-top-color: color-mix(in srgb, var(--tux-border-subtle) 68%, transparent);
}

.product-price {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.product-price,
.product-quantity,
.product-quantity output,
.quantity-control,
.money-input-wrap,
.tender-suggestions,
.split-remainder,
.change-row,
.cart-line-top,
.cart-totals,
.payment-summary,
.fee-reference {
  font-variant-numeric: tabular-nums;
}

.cart-line-top strong {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.cart-section h2,
.product-search > label,
.field-stack > span,
.money-field > label {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0;
}

.cart-totals .grand-total dt {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.cart-totals .grand-total dd {
  font-size: 22px;
  line-height: 26px;
  font-weight: 700;
}

.place-order-action {
  min-height: 3rem;
  font-size: 16px;
  line-height: 20px;
  font-weight: 600;
}

.place-order-action strong {
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
}

@media (max-width: 74rem) and (min-width: 54.0625rem) {
  .operations-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .operations-nav {
    justify-self: start;
    max-width: 100%;
    overflow-x: auto;
  }
}
'''
    premium.write_text(text)
