import { describe, expect, it } from 'vitest';
import {
  OnlineOrderIntakeContractError,
  parseOnlineOrderIntakeSuccessV1,
  parseOnlineOrderRequestV1,
} from './index';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ADDON_ID = '44444444-4444-4444-8444-444444444444';
const MODIFIER_ID = '55555555-5555-4555-8555-555555555555';
const BEVERAGE_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

function validRequest() {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    customer: {
      name: 'Ahmed Mohamed',
      phone: '+201001234567',
      address: 'Nasr City, Cairo',
    },
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    items: [
      {
        productId: PRODUCT_ID,
        quantity: 2,
        addonProductIds: [ADDON_ID],
        modifierSelections: [{ modifierId: MODIFIER_ID, quantity: 1 }],
        comboBeverageProductId: BEVERAGE_ID,
        note: 'No onions',
      },
    ],
    orderNote: 'Call on arrival',
  };
}

describe('online order intake transport contract', () => {
  it('parses a bounded delivery request without client-authoritative money or POS facts', () => {
    expect(parseOnlineOrderRequestV1(validRequest())).toEqual(validRequest());
  });

  it('allows pickup to omit phone and address because delivery identity is not required', () => {
    const request = validRequest();
    const parsed = parseOnlineOrderRequestV1({
      ...request,
      customer: { ...request.customer, phone: null, address: null },
      fulfillmentPreference: 'PICKUP',
    });

    expect(parsed.customer).toEqual({
      name: 'Ahmed Mohamed',
      phone: null,
      address: null,
    });
  });

  it('requires both phone and address for delivery', () => {
    const request = validRequest();

    expect(() =>
      parseOnlineOrderRequestV1({
        ...request,
        customer: { ...request.customer, phone: null },
      }),
    ).toThrow(OnlineOrderIntakeContractError);
    expect(() =>
      parseOnlineOrderRequestV1({
        ...request,
        customer: { ...request.customer, address: null },
      }),
    ).toThrow(OnlineOrderIntakeContractError);
  });

  it.each(['CASH', 'INSTAPAY', 'MIXED'] as const)(
    'accepts %s as payment preference intent without settlement authority',
    (paymentPreference) => {
      expect(parseOnlineOrderRequestV1({ ...validRequest(), paymentPreference }).paymentPreference).toBe(
        paymentPreference,
      );
    },
  );

  it.each([
    ['priceMinor', 19050],
    ['subtotalMinor', 38100],
    ['totalMinor', 38100],
    ['deliveryFeeMinor', 5000],
    ['businessDayId', '88888888-8888-4888-8888-888888888888'],
    ['operator', { id: 'worker-1' }],
    ['cashReceivedMinor', 50000],
    ['changeMinor', 11900],
    ['zoneId', '99999999-9999-4999-8999-999999999999'],
    ['payments', [{ method: 'CASH', amountMinor: 38100 }]],
  ])('rejects unexpected client-authoritative root field %s', (field, value) => {
    expect(() => parseOnlineOrderRequestV1({ ...validRequest(), [field]: value })).toThrow(
      OnlineOrderIntakeContractError,
    );
  });

  it.each([
    ['price', 190.5],
    ['priceMinor', 19050],
    ['name', 'Client supplied name'],
    ['variantId', 'local-only-variant-id'],
  ])('rejects unexpected line authority field %s', (field, value) => {
    const request = validRequest();
    request.items = [{ ...request.items[0]!, [field]: value }];

    expect(() => parseOnlineOrderRequestV1(request)).toThrow(OnlineOrderIntakeContractError);
  });

  it('rejects invalid UUID identities and duplicate addon product IDs', () => {
    const invalidProduct = validRequest();
    invalidProduct.items[0]!.productId = 'not-a-uuid';
    expect(() => parseOnlineOrderRequestV1(invalidProduct)).toThrow(OnlineOrderIntakeContractError);

    const duplicateAddon = validRequest();
    duplicateAddon.items[0]!.addonProductIds = [ADDON_ID, ADDON_ID];
    expect(() => parseOnlineOrderRequestV1(duplicateAddon)).toThrow(OnlineOrderIntakeContractError);
  });

  it('enforces item, selection, quantity, and text bounds', () => {
    const zeroQuantity = validRequest();
    zeroQuantity.items[0]!.quantity = 0;
    expect(() => parseOnlineOrderRequestV1(zeroQuantity)).toThrow(OnlineOrderIntakeContractError);

    const tooManyItems = validRequest();
    tooManyItems.items = Array.from({ length: 51 }, () => ({ ...validRequest().items[0]! }));
    expect(() => parseOnlineOrderRequestV1(tooManyItems)).toThrow(OnlineOrderIntakeContractError);

    const tooManyAddons = validRequest();
    tooManyAddons.items[0]!.addonProductIds = Array.from(
      { length: 21 },
      (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    );
    expect(() => parseOnlineOrderRequestV1(tooManyAddons)).toThrow(OnlineOrderIntakeContractError);

    const longName = validRequest();
    longName.customer.name = 'A'.repeat(201);
    expect(() => parseOnlineOrderRequestV1(longName)).toThrow(OnlineOrderIntakeContractError);

    const longNote = validRequest();
    longNote.orderNote = 'N'.repeat(1001);
    expect(() => parseOnlineOrderRequestV1(longNote)).toThrow(OnlineOrderIntakeContractError);
  });

  it('allows only supported fulfillment and payment preference enums', () => {
    expect(() =>
      parseOnlineOrderRequestV1({ ...validRequest(), fulfillmentPreference: 'DINE_IN' }),
    ).toThrow(OnlineOrderIntakeContractError);
    expect(() =>
      parseOnlineOrderRequestV1({ ...validRequest(), paymentPreference: 'CARD' }),
    ).toThrow(OnlineOrderIntakeContractError);
  });

  it('parses only a minimal PENDING intake success response', () => {
    expect(
      parseOnlineOrderIntakeSuccessV1({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'PENDING',
      }),
    ).toEqual({
      schemaVersion: 1,
      requestId: REQUEST_ID,
      status: 'PENDING',
    });

    expect(() =>
      parseOnlineOrderIntakeSuccessV1({
        schemaVersion: 1,
        requestId: REQUEST_ID,
        status: 'PENDING',
        displayOrderNo: 123,
      }),
    ).toThrow(OnlineOrderIntakeContractError);
  });
});
