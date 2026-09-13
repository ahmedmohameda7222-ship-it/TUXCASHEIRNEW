import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from './catalog';
import { parseEntityId, type PaymentMethodId, type ShopId } from './ids';
import { moneyMinor } from './money';
import { preparePaymentParts } from './payment';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const WALLET_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000003');
const CARD_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000004');

const methods: PaymentMethod[] = [
  {
    id: WALLET_ID,
    shopId: SHOP_ID,
    displayName: 'Wallet transfer',
    logicType: 'DIGITAL',
    requiresReconciliation: true,
    requiresReference: true,
    active: true,
    sortOrder: 1,
  },
  {
    id: CARD_ID,
    shopId: SHOP_ID,
    displayName: 'Card',
    logicType: 'CARD',
    requiresReconciliation: true,
    requiresReference: false,
    active: true,
    sortOrder: 2,
  },
];

describe('payment reference authority', () => {
  it('rejects a required-reference payment when the reference is missing or blank', () => {
    expect(() =>
      preparePaymentParts(
        { mode: 'SINGLE', methodId: WALLET_ID, cashReceivedMinor: null },
        methods,
        moneyMinor(10_000),
      ),
    ).toThrow('Payment reference is required for the selected payment method.');

    expect(() =>
      preparePaymentParts(
        {
          mode: 'SINGLE',
          methodId: WALLET_ID,
          cashReceivedMinor: null,
          reference: '   ',
        } as never,
        methods,
        moneyMinor(10_000),
      ),
    ).toThrow('Payment reference is required for the selected payment method.');
  });

  it('trims and preserves the reference on the prepared payment part', () => {
    const [part] = preparePaymentParts(
      {
        mode: 'SINGLE',
        methodId: WALLET_ID,
        cashReceivedMinor: null,
        reference: '  TXN-2026-0091  ',
      } as never,
      methods,
      moneyMinor(10_000),
    );

    expect(part).toMatchObject({
      allocatedMinor: moneyMinor(10_000),
      reference: 'TXN-2026-0091',
    });
  });

  it('validates required references independently for split-payment legs', () => {
    expect(() =>
      preparePaymentParts(
        {
          mode: 'SPLIT',
          methodAId: WALLET_ID,
          amountAMinor: moneyMinor(4_000),
          methodBId: CARD_ID,
          referenceA: null,
          referenceB: null,
        } as never,
        methods,
        moneyMinor(10_000),
      ),
    ).toThrow('Payment reference is required for the selected payment method.');

    const parts = preparePaymentParts(
      {
        mode: 'SPLIT',
        methodAId: WALLET_ID,
        amountAMinor: moneyMinor(4_000),
        methodBId: CARD_ID,
        referenceA: '  WALLET-44  ',
        referenceB: null,
      } as never,
      methods,
      moneyMinor(10_000),
    );

    expect(parts[0]).toMatchObject({ reference: 'WALLET-44' });
    expect(parts[1]).toMatchObject({ reference: null });
  });
});
