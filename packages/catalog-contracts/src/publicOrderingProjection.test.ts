import { describe, expect, it } from 'vitest';
import { CatalogContractError, parsePublicCatalogSnapshotV2 } from './index';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function validSnapshotV2() {
  return {
    schemaVersion: 2,
    shopId: SHOP_ID,
    revision: 'b'.repeat(64),
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    shop: {
      displayName: 'TUX Maadi',
      address: 'Road 9, Maadi',
      phone: '+201000000000',
      latitude: 29.9602,
      longitude: 31.2569,
    },
    ordering: {
      available: true,
      temporaryClosed: false,
      onlineOrdersPaused: false,
      minimumOrderMinor: 3000,
      serviceChargeBps: 500,
      taxBps: 1400,
      fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
      paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
    },
  } as const;
}

describe('PublicCatalogSnapshotV2 ordering projection', () => {
  it('parses canonical customer-safe shop identity and online ordering policy', () => {
    const snapshot = validSnapshotV2();
    expect(parsePublicCatalogSnapshotV2(snapshot)).toEqual(snapshot);
  });

  it('fails closed on internal payment integration metadata', () => {
    const snapshot = validSnapshotV2();
    expect(() =>
      parsePublicCatalogSnapshotV2({
        ...snapshot,
        ordering: {
          ...snapshot.ordering,
          integrationReference: 'INSTAPAY',
        },
      }),
    ).toThrow(CatalogContractError);
  });

  it('rejects unsupported browser checkout preferences', () => {
    const snapshot = validSnapshotV2();
    expect(() =>
      parsePublicCatalogSnapshotV2({
        ...snapshot,
        ordering: {
          ...snapshot.ordering,
          paymentPreferences: ['CASH', 'CARD'],
        },
      }),
    ).toThrow(/paymentPreferences/);
  });

  it('rejects unsafe minimum-order money', () => {
    const snapshot = validSnapshotV2();
    expect(() =>
      parsePublicCatalogSnapshotV2({
        ...snapshot,
        ordering: {
          ...snapshot.ordering,
          minimumOrderMinor: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).toThrow(/minimumOrderMinor/);
  });

  it.each([
    ['serviceChargeBps', -1],
    ['serviceChargeBps', 10_001],
    ['taxBps', -1],
    ['taxBps', 10_001],
  ] as const)('rejects an invalid %s checkout rate', (key, value) => {
    const snapshot = validSnapshotV2();
    expect(() =>
      parsePublicCatalogSnapshotV2({
        ...snapshot,
        ordering: {
          ...snapshot.ordering,
          [key]: value,
        },
      }),
    ).toThrow(new RegExp(key));
  });
});
