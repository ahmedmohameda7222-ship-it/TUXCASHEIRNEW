from pathlib import Path

path = Path("e2e/operations.e2e.ts")
text = path.read_text()
old = """  const deliveryTotal = cart.getByRole('textbox', { name: 'Delivery', exact: true });
  await expect(deliveryTotal).toBeVisible();
  await deliveryTotal.fill('45');
  await deliveryTotal.blur();
  await shot('followup-07-delivery-fee-totals-1440.png');
"""
new = """  const deliveryTotal = cart.getByRole('textbox', { name: 'Delivery', exact: true });
  await expect(deliveryTotal).toBeVisible();
  await expect(deliveryTotal).toBeDisabled();
  await expect(deliveryTotal).toHaveValue('35.00');
  await shot('followup-07-delivery-fee-totals-1440.png');
"""
if text.count(old) != 1:
    raise SystemExit(f"expected exactly one delivery evidence anchor, found {text.count(old)}")
path.write_text(text.replace(old, new))
