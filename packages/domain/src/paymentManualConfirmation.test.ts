import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from './catalog';
import { parseEntityId, type PaymentMethodId, type ShopId } from './ids';
import { moneyMinor } from './money';
import { preparePaymentParts } from './payment';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const MANUAL_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000011');
const AUTO_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000012');

const methods: PaymentMethod[] = [
  {
    id: MANUAL_ID,
    shopId: SHOP_ID,
    displayName: 'Manual terminal',
    logicType: 'DIGITAL',
    requiresReconciliation: true,
    requiresReference: false,
    manualConfirmationRequired: true,
    active: true,
    sortOrder: 1,
  },
  {
    id: AUTO_ID,
    shopId: SHOP_ID,
    displayName: 'Auto payment',
    logicType: 'DIGITAL',
    requiresReconciliation: true,
    requiresReference: false,
    manualConfirmationRequired: false,
    active: true,
    sortOrder: 2,
  },
];

describe('manual payment confirmation authority', () => {
  it('rejects a payment that requires manual confirmation until confirmation evidence is supplied', () => {
    expect(() =>
      preparePaymentParts(
        {
          mode: 'SINGLE',
          methodId: MANUAL_ID,
          cashReceivedMinor: null,
          manualConfirmed: false,
        } as never,
        methods,
        moneyMinor(10_000),
      ),
    ).toThrow(/manual confirmation/i);

    const [part] = preparePaymentParts(
      {
        mode: 'SINGLE',
        methodId: MANUAL_ID,
        cashReceivedMinor: null,
        manualConfirmed: true,
      } as never,
      methods,
      moneyMinor(10_000),
    );

    expect(part).toMatchObject({ manualConfirmed: true });
  });

  it('requires confirmation independently for each split leg', () => {
    expect(() =>
      preparePaymentParts(
        {
          mode: 'SPLIT',
          methodAId: MANUAL_ID,
          amountAMinor: moneyMinor(4_000),
          methodBId: AUTO_ID,
          manualConfirmedA: false,
          manualConfirmedB: false,
        } as never,
        methods,
        moneyMinor(10_000),
      ),
    ).toThrow(/manual confirmation/i);

    const parts = preparePaymentParts(
      {
        mode: 'SPLIT',
        methodAId: MANUAL_ID,
        amountAMinor: moneyMinor(4_000),
        methodBId: AUTO_ID,
        manualConfirmedA: true,
        manualConfirmedB: false,
      } as never,
      methods,
      moneyMinor(10_000),
    );

    expect(parts[0]).toMatchObject({ manualConfirmed: true });
    expect(parts[1]).toMatchObject({ manualConfirmed: false });
  });
});
