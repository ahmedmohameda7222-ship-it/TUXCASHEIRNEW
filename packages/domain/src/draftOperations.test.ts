import { describe, expect, it } from 'vitest';
import type { OperationsConfigurationSnapshot, Product } from './catalog';
import {
  addProductUnit,
  applyDeliveryZone,
  decrementProductUnit,
  productQuantityInDraft,
} from './draftOperations';
import {
  parseEntityId,
  type BusinessDayId,
  type DeliveryZoneId,
  type DraftLineId,
  type MenuCategoryId,
  type ModifierId,
  type ProductId,
  type ShopId,
} from './ids';
import { moneyMinor, ZERO_MONEY } from './money';
import type { OrderDraft } from './orderDraft';
import { instant } from './time';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const BUSINESS_DAY_ID = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001');
const BURGER_ID = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000001');
const COMBO_ID = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000002');
const DRINK_ID = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000003');
const SOLD_OUT_ID = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000004');
const MODIFIER_ID = parseEntityId<ModifierId>('50000000-0000-4000-8000-000000000001');
const ZONE_ID = parseEntityId<DeliveryZoneId>('60000000-0000-4000-8000-000000000001');

function product(input: Partial<Product> & Pick<Product, 'id' | 'name'>): Product {
  return {
    id: input.id,
    shopId: SHOP_ID,
    categoryId: CATEGORY_ID,
    name: input.name,
    description: null,
    priceMinor: input.priceMinor ?? moneyMinor(16_000),
    imageKey: null,
    active: input.active ?? true,
    soldOut: input.soldOut ?? false,
    isCombo: input.isCombo ?? false,
    sortOrder: input.sortOrder ?? 0,
  };
}

function configuration(): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: 1,
    updatedAt: instant('2026-08-18T10:00:00.000Z'),
    categories: [
      { id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true },
    ],
    products: [
      product({ id: BURGER_ID, name: 'Single Burger' }),
      product({ id: COMBO_ID, name: 'Burger Combo', isCombo: true, priceMinor: moneyMinor(22_000) }),
      product({ id: DRINK_ID, name: 'Cola', priceMinor: ZERO_MONEY }),
      product({ id: SOLD_OUT_ID, name: 'Sold Out Burger', soldOut: true }),
    ],
    modifiers: [
      {
        id: MODIFIER_ID,
        shopId: SHOP_ID,
        name: 'Extra Cheese',
        priceMinor: moneyMinor(2_500),
        standaloneProductId: null,
        active: true,
        sortOrder: 0,
      },
    ],
    productModifierLinks: [
      {
        shopId: SHOP_ID,
        productId: BURGER_ID,
        modifierId: MODIFIER_ID,
        maxQuantity: 2,
        sortOrder: 0,
      },
    ],
    comboBeverageOptions: [
      { shopId: SHOP_ID, comboProductId: COMBO_ID, beverageProductId: DRINK_ID, sortOrder: 0 },
    ],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [],
    deliveryZones: [
      {
        id: ZONE_ID,
        shopId: SHOP_ID,
        name: 'Nasr City',
        feeMinor: moneyMinor(3_500),
        active: true,
        sortOrder: 0,
      },
    ],
  };
}

function emptyDraft(): OrderDraft {
  return {
    shopId: SHOP_ID,
    businessDayId: BUSINESS_DAY_ID,
    draftScopeId: 'test-scope',
    revision: 0,
    updatedAt: instant('2026-08-18T10:00:00.000Z'),
    checkoutIntentKey: 'checkout-intent',
    orderTypeId: null,
    lines: [],
    orderNote: null,
    discountMinor: ZERO_MONEY,
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: ZERO_MONEY,
      finalFeeMinor: ZERO_MONEY,
    },
    payment: { mode: 'NONE' },
  };
}

function lineId(value: number): DraftLineId {
  return parseEntityId<DraftLineId>(`70000000-0000-4000-8000-${value.toString().padStart(12, '0')}`);
}

describe('draft operations', () => {
  it('merges identical non-combo additions while preserving total product quantity', () => {
    const config = configuration();
    const first = addProductUnit({
      draft: emptyDraft(),
      configuration: config,
      productId: BURGER_ID,
      lineId: lineId(1),
      addedSequence: 1,
    });
    const second = addProductUnit({
      draft: first,
      configuration: config,
      productId: BURGER_ID,
      lineId: lineId(2),
      addedSequence: 2,
    });

    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]?.quantity).toBe(2);
    expect(second.lines[0]?.addedSequence).toBe(2);
    expect(productQuantityInDraft(second, BURGER_ID)).toBe(2);
  });

  it('decrements the most recently added configuration deterministically', () => {
    const config = configuration();
    const plain = addProductUnit({
      draft: emptyDraft(),
      configuration: config,
      productId: BURGER_ID,
      lineId: lineId(1),
      addedSequence: 1,
    });
    const customized = addProductUnit({
      draft: plain,
      configuration: config,
      productId: BURGER_ID,
      lineId: lineId(2),
      addedSequence: 2,
      customization: {
        modifiers: [{ modifierId: MODIFIER_ID, quantity: 1 }],
        comboBeverageProductIds: [],
        itemNote: 'No onions',
      },
    });

    const decremented = decrementProductUnit(customized, BURGER_ID);
    expect(decremented.lines).toHaveLength(1);
    expect(decremented.lines[0]?.id).toBe(lineId(1));
    expect(decremented.lines[0]?.itemNote).toBeNull();
  });

  it('blocks Sold Out products from receiving new draft units', () => {
    expect(() =>
      addProductUnit({
        draft: emptyDraft(),
        configuration: configuration(),
        productId: SOLD_OUT_ID,
        lineId: lineId(1),
        addedSequence: 1,
      }),
    ).toThrow('Sold Out products cannot receive new draft units.');
  });

  it('requires exactly one allowed available beverage for each combo unit', () => {
    const config = configuration();
    expect(() =>
      addProductUnit({
        draft: emptyDraft(),
        configuration: config,
        productId: COMBO_ID,
        lineId: lineId(1),
        addedSequence: 1,
      }),
    ).toThrow('Each combo unit requires one included beverage selection.');

    const added = addProductUnit({
      draft: emptyDraft(),
      configuration: config,
      productId: COMBO_ID,
      lineId: lineId(1),
      addedSequence: 1,
      customization: {
        modifiers: [],
        comboBeverageProductIds: [DRINK_ID],
        itemNote: null,
      },
    });
    expect(added.lines[0]?.comboBeverages).toEqual([{ productId: DRINK_ID, label: 'Cola' }]);
  });

  it('enforces configured modifier eligibility and quantity limits', () => {
    expect(() =>
      addProductUnit({
        draft: emptyDraft(),
        configuration: configuration(),
        productId: BURGER_ID,
        lineId: lineId(1),
        addedSequence: 1,
        customization: {
          modifiers: [{ modifierId: MODIFIER_ID, quantity: 3 }],
          comboBeverageProductIds: [],
          itemNote: null,
        },
      }),
    ).toThrow('Selected modifier quantity exceeds its configured maximum.');
  });

  it('snapshots configured and editable final delivery fees when a zone is selected', () => {
    const zone = configuration().deliveryZones[0];
    if (zone === undefined) throw new Error('Expected delivery zone fixture.');

    const withZone = applyDeliveryZone(emptyDraft(), zone);
    expect(withZone.delivery.zoneId).toBe(ZONE_ID);
    expect(withZone.delivery.zoneLabel).toBe('Nasr City');
    expect(withZone.delivery.configuredFeeMinor).toBe(moneyMinor(3_500));
    expect(withZone.delivery.finalFeeMinor).toBe(moneyMinor(3_500));
  });
});
