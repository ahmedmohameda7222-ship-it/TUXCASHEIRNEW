from pathlib import Path

path = Path('apps/operations/src/styles/premium.css')
text = path.read_text()

before_headings = """.cart-section h2,
.product-search > label,
.field-stack > span,
.money-field > label {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0;
}
"""
after_headings = """.cart-section h2 {
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: 0;
}

.product-search > label,
.field-stack > span,
.money-field > label {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0;
}
"""

before_total = """.cart-totals .grand-total dt {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}
"""
after_total = """.cart-totals .grand-total dt {
  font-size: 18px;
  line-height: 22px;
  font-weight: 600;
}
"""

if after_headings not in text:
    if before_headings not in text:
        raise SystemExit('Expected cart subsection typography block was not found.')
    text = text.replace(before_headings, after_headings, 1)

if after_total not in text:
    if before_total not in text:
        raise SystemExit('Expected final total label typography block was not found.')
    text = text.replace(before_total, after_total, 1)

path.write_text(text)
