from pathlib import Path

path = Path('e2e/operations.e2e.ts')
source = path.read_text()

old_delivery = "const deliveryTotal = cart.getByLabel('Delivery', { exact: true });"
new_delivery = "const deliveryTotal = cart.getByRole('textbox', { name: 'Delivery', exact: true });"
if source.count(old_delivery) != 1:
    raise SystemExit(f'expected one ambiguous delivery locator, got {source.count(old_delivery)}')
source = source.replace(old_delivery, new_delivery, 1)

old_mobile = """  const lastPaymentControl = mobileCart.locator('.payment-section').last();
  const footer = mobileCart.locator('.cart-totals');
  const [paymentBox, footerBox] = await Promise.all([
    lastPaymentControl.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(paymentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (paymentBox!.y + paymentBox!.height)).toBeGreaterThanOrEqual(16);"""
new_mobile = """  const finalPaymentControl = mobileCart
    .locator(
      '.payment-section button:not([disabled]), .payment-section input:not([disabled]), .payment-section select:not([disabled])',
    )
    .last();
  await finalPaymentControl.scrollIntoViewIfNeeded();
  const footer = mobileCart.locator('.cart-totals');
  const [paymentBox, footerBox] = await Promise.all([
    finalPaymentControl.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(paymentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (paymentBox!.y + paymentBox!.height)).toBeGreaterThanOrEqual(16);"""
if source.count(old_mobile) != 1:
    raise SystemExit(f'expected one mobile footer measurement block, got {source.count(old_mobile)}')
source = source.replace(old_mobile, new_mobile, 1)

path.write_text(source)
print('fixed follow-up evidence runtime locators')
