import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from './catalog';
import { parseEntityId, type PaymentMethodId, type ShopId } from './ids';
import { moneyMinor } from './money';
import { parsePoundsToMinor, parseWholePoundsToMinor, preparePaymentParts } from './payment';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const CASH_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000001');
const CARD_ID = parseEntityId<PaymentMethodId>('20000000-0000-4000-8000-000000000002');

const methods: PaymentMethod[] = [
  {
    id: CASH_ID,
    shopId: SHOP_ID,
    displayName: 'Cash Payment',
    logicType: 'CASH',
    requiresReconciliation: true,
    active: true,
    sortOrder: 1,
  },
  {
    id: CARD_ID,
    shopId: SHOP_ID,
    displayName: 'Visa Counter',
    logicType: 'CARD',
    requiresReconciliation: true,
    active: true,
    sortOrder: 2,
  },
];

describe('preparePaymentParts', () => {
  it('calculates Cash Change from the stable CASH logic type rather than display name', () => {
    const [part] = preparePaymentParts(
      { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(20_000) },
      methods,
      moneyMinor(18_000),
    );
    expect(part).toMatchObject({
      allocatedMinor: moneyMinor(18_000),
      receivedMinor: moneyMinor(20_000),
      changeMinor: moneyMinor(2_000),
    });
  });

  it('blocks insufficient Cash Received', () => {
    expect(() =>
      preparePaymentParts(
        { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(17_999) },
        methods,
        moneyMinor(18_000),
      ),
    ).toThrow('Cash Received cannot be less than the Cash allocation.');
  });

  it('auto-calculates Method B as the exact split remainder', () => {
    const parts = preparePaymentParts(
      {
        mode: 'SPLIT',
        methodAId: CARD_ID,
        amountAMinor: moneyMinor(10_000),
        methodACashReceivedMinor: null,
        methodBId: CASH_ID,
        methodBCashReceivedMinor: moneyMinor(10_000),
      },
      methods,
      moneyMinor(18_000),
    );
    expect(parts.map((part) => part.allocatedMinor)).toEqual([
      moneyMinor(10_000),
      moneyMinor(8_000),
    ]);
    expect(parts[1]?.changeMinor).toBe(moneyMinor(2_000));
  });

  it('rejects duplicate split methods', () => {
    expect(() =>
      preparePaymentParts(
        {
          mode: 'SPLIT',
          methodAId: CARD_ID,
          amountAMinor: moneyMinor(10_000),
          methodACashReceivedMinor: null,
          methodBId: CARD_ID,
          methodBCashReceivedMinor: null,
        },
        methods,
        moneyMinor(18_000),
      ),
    ).toThrow('Split payment methods must be different.');
  });
});

describe('money input parsing', () => {
  it('parses whole and two-decimal pound inputs exactly into minor units', () => {
    expect(parsePoundsToMinor('160')).toBe(moneyMinor(16_000));
    expect(parsePoundsToMinor('160.5')).toBe(moneyMinor(16_050));
    expect(parsePoundsToMinor('160.05')).toBe(moneyMinor(16_005));
    expect(parsePoundsToMinor(' 0.75 ')).toBe(moneyMinor(75));
  });

  it('rejects malformed, over-precision and unsafe values without floating point coercion', () => {
    expect(parsePoundsToMinor('')).toBeNull();
    expect(parsePoundsToMinor('.5')).toBeNull();
    expect(parsePoundsToMinor('1.234')).toBeNull();
    expect(parsePoundsToMinor('-1')).toBeNull();
    expect(parsePoundsToMinor('90071992547410')).toBeNull();
  });

  it('keeps the legacy whole-pound parser strict', () => {
    expect(parseWholePoundsToMinor('125')).toBe(moneyMinor(12_500));
    expect(parseWholePoundsToMinor('125.00')).toBeNull();
  });
});
