import { describe, expect, it } from 'vitest';
import { moneyMinor } from './money';
import { parseEntityId, type BusinessDayId, type ShopId, type WorkerId } from './ids';
import { instant } from './time';
import type { OrderDraft } from './orderDraft';
import { assertParkedOrderDraftInvariant, type ParkedOrderDraft } from './parkedOrderDraft';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const businessDayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');

function draft(): OrderDraft {
  return {
    shopId,
    businessDayId,
    draftScopeId: 'orders-main',
    revision: 1,
    updatedAt: instant('2026-09-04T00:00:00.000Z'),
    checkoutIntentKey: '44444444-4444-4444-8444-444444444444',
    orderTypeId: null,
    lines: [],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: { mode: 'NONE' },
  };
}

function parked(overrides: Partial<ParkedOrderDraft> = {}): ParkedOrderDraft {
  return {
    id: 'parked-1',
    shopId,
    businessDayId,
    draftScopeId: 'orders-main',
    draft: draft(),
    parkedAt: instant('2026-09-04T00:01:00.000Z'),
    parkedByWorkerId: workerId,
    state: 'PARKED',
    resolvedAt: null,
    resolvedByWorkerId: null,
    ...overrides,
  };
}

describe('assertParkedOrderDraftInvariant', () => {
  it('accepts PARKED only while unresolved', () => {
    expect(() => assertParkedOrderDraftInvariant(parked())).not.toThrow();
    expect(() =>
      assertParkedOrderDraftInvariant(parked({ resolvedAt: instant('2026-09-04T00:02:00.000Z') })),
    ).toThrow();
    expect(() =>
      assertParkedOrderDraftInvariant(parked({ resolvedByWorkerId: workerId })),
    ).toThrow();
  });

  it.each(['RESTORED', 'DISCARDED'] as const)(
    'requires resolver identity and time for %s',
    (state) => {
      expect(() =>
        assertParkedOrderDraftInvariant(
          parked({
            state,
            resolvedAt: instant('2026-09-04T00:02:00.000Z'),
            resolvedByWorkerId: workerId,
          }),
        ),
      ).not.toThrow();
      expect(() => assertParkedOrderDraftInvariant(parked({ state }))).toThrow();
    },
  );

  it('rejects mismatched nested shop/day/scope authority', () => {
    expect(() =>
      assertParkedOrderDraftInvariant(
        parked({ shopId: parseEntityId<ShopId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') }),
      ),
    ).toThrow();
    expect(() =>
      assertParkedOrderDraftInvariant(
        parked({
          businessDayId: parseEntityId<BusinessDayId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        }),
      ),
    ).toThrow();
    expect(() =>
      assertParkedOrderDraftInvariant(parked({ draftScopeId: 'other-scope' })),
    ).toThrow();
  });

  it('rejects blank parked ids and unsupported state combinations', () => {
    expect(() => assertParkedOrderDraftInvariant(parked({ id: ' ' }))).toThrow();
  });
});
