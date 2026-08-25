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
  it('treats blank single-cash tender as exact payment', () => {
    const parts = preparePaymentParts(
      { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: null },
      methods,
      moneyMinor(40_000),
    );

    expect(parts).toEqual([
      expect.objectContaining({
        allocatedMinor: moneyMinor(40_000),
        receivedMinor: moneyMinor(40_000),
        changeMinor: moneyMinor(0),
      }),
    ]);
  });

  it('calculates Cash Change from an explicit tender using the stable CASH logic type', () => {
    const [part] = preparePaymentParts(
      { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(50_000) },
      methods,
      moneyMinor(40_000),
    );
    expect(part).toMatchObject({
      allocatedMinor: moneyMinor(40_000),
      receivedMinor: moneyMinor(50_000),
      changeMinor: moneyMinor(10_000),
    });
  });

  it('blocks insufficient explicit Cash Received', () => {
    expect(() =>
      preparePaymentParts(
        { mode: 'SINGLE', methodId: CASH_ID, cashReceivedMinor: moneyMinor(39_999) },
        methods,
        moneyMinor(40_000),
      ),
    ).toThrow('Cash Received cannot be less than the Cash allocation.');
  });

  it('prepares a cash split leg as exact allocation without tender fields', () => {
    const parts = preparePaymentParts(
      {
        mode: 'SPLIT',
        methodAId: CASH_ID,
        amountAMinor: moneyMinor(32_000),
        methodBId: CARD_ID,
      },
      methods,
      moneyMinor(40_000),
    );

    expect(parts[0]).toEqual(
      expect.objectContaining({
        allocatedMinor: moneyMinor(32_000),
        receivedMinor: moneyMinor(32_000),
        changeMinor: moneyMinor(0),
      }),
    );
    expect(parts[1]).toEqual(
      expect.objectContaining({
        allocatedMinor: moneyMinor(8_000),
        receivedMinor: null,
        changeMinor: null,
      }),
    );
  });

  it('auto-calculates Method B as the exact split remainder', () => {
    const parts = preparePaymentParts(
      {
        mode: 'SPLIT',
        methodAId: CARD_ID,
        amountAMinor: moneyMinor(10_000),
        methodBId: CASH_ID,
      },
      methods,
      moneyMinor(18_000),
    );
    expect(parts.map((part) => part.allocatedMinor)).toEqual([
      moneyMinor(10_000),
      moneyMinor(8_000),
    ]);
    expect(parts[1]).toMatchObject({
      receivedMinor: moneyMinor(8_000),
      changeMinor: moneyMinor(0),
    });
  });

  it('rejects duplicate split methods', () => {
    expect(() =>
      preparePaymentParts(
        {
          mode: 'SPLIT',
          methodAId: CARD_ID,
          amountAMinor: moneyMinor(10_000),
          methodBId: CARD_ID,
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
