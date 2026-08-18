import type { MoneyMinor, OrderSnapshot, PaymentPart } from '@tux/domain';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value: MoneyMinor): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const pounds = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${pounds.toString()}.${cents}`;
}

function paymentDescription(payment: PaymentPart): string {
  if (payment.method.logicType === 'CASH') {
    return `${payment.method.label}: ${formatMoney(payment.allocatedMinor)} · received ${formatMoney(payment.receivedMinor)} · change ${formatMoney(payment.changeMinor)}`;
  }
  return `${payment.method.label}: ${formatMoney(payment.allocatedMinor)}`;
}

export function renderOrderReceiptHtml(order: OrderSnapshot): string {
  const itemRows = order.items
    .map((item) => {
      const modifiers = item.modifiers
        .map(
          (modifier) =>
            `<div class="detail">+ ${escapeHtml(modifier.label)} × ${modifier.quantity}</div>`,
        )
        .join('');
      const beverages = item.comboBeverages
        .map((beverage) => `<div class="detail">Drink: ${escapeHtml(beverage.label)}</div>`)
        .join('');
      const note =
        item.itemNote === null
          ? ''
          : `<div class="detail note">Note: ${escapeHtml(item.itemNote)}</div>`;
      return `<div class="item">
        <div class="row"><strong>${escapeHtml(item.productName)} × ${item.quantity}</strong><span>${formatMoney(item.unitPriceMinor)}</span></div>
        ${modifiers}${beverages}${note}
      </div>`;
    })
    .join('');

  const delivery =
    order.fulfillment.behavior === 'DELIVERY'
      ? `<section class="block">
          <div><strong>${escapeHtml(order.fulfillment.delivery.customerName)}</strong></div>
          <div>${escapeHtml(order.fulfillment.delivery.normalizedPhone)}</div>
          <div>${escapeHtml(order.fulfillment.delivery.zoneLabel)}</div>
          <div>${escapeHtml(order.fulfillment.delivery.address)}</div>
        </section>`
      : '';

  const orderNote =
    order.orderNote === null
      ? ''
      : `<section class="block note"><strong>Order note</strong><div>${escapeHtml(order.orderNote)}</div></section>`;
  const paymentRows = order.payments
    .map((payment) => `<div>${escapeHtml(paymentDescription(payment))}</div>`)
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>TUX Order #${order.displayOrderNo}</title>
<style>
  @page { margin: 4mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #000; background: #fff; font-family: Arial, sans-serif; }
  body { width: 72mm; padding: 2mm; font-size: 11px; line-height: 1.35; }
  h1 { margin: 0; font-size: 19px; letter-spacing: 0.14em; text-align: center; }
  .meta { margin-top: 2mm; text-align: center; font-size: 10px; }
  .block { padding: 2mm 0; border-top: 1px dashed #666; }
  .item { padding: 1.5mm 0; border-top: 1px dotted #aaa; }
  .row { display: flex; justify-content: space-between; gap: 3mm; }
  .detail { padding-left: 3mm; font-size: 10px; }
  .note { white-space: pre-wrap; }
  .totals { margin-top: 1mm; padding-top: 2mm; border-top: 1px dashed #444; }
  .total { margin-top: 1mm; padding-top: 1mm; border-top: 1px solid #000; font-size: 14px; font-weight: 700; }
  .footer { margin-top: 3mm; padding-top: 2mm; border-top: 1px dashed #666; text-align: center; font-size: 9px; }
</style>
</head>
<body>
  <h1>TUX</h1>
  <div class="meta">
    <div><strong>Order #${order.displayOrderNo}</strong> · ${escapeHtml(order.fulfillment.orderTypeLabel)}</div>
    <div>${escapeHtml(order.createdAt)}</div>
    <div>Operator: ${escapeHtml(order.operatorName)}</div>
  </div>
  ${delivery}
  <section class="block">${itemRows}</section>
  ${orderNote}
  <section class="totals">
    <div class="row"><span>Items</span><span>${formatMoney(order.itemsSubtotalMinor)}</span></div>
    ${order.discountMinor === 0 ? '' : `<div class="row"><span>Discount</span><span>-${formatMoney(order.discountMinor)}</span></div>`}
    ${order.deliveryFeeMinor === 0 ? '' : `<div class="row"><span>Delivery</span><span>${formatMoney(order.deliveryFeeMinor)}</span></div>`}
    <div class="row total"><span>Total EGP</span><span>${formatMoney(order.totalMinor)}</span></div>
  </section>
  <section class="block">${paymentRows}</section>
  <div class="footer">Saved locally before printing · ${escapeHtml(order.id)}</div>
</body>
</html>`;
}
