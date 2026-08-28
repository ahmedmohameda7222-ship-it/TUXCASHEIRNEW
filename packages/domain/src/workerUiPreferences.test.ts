import { describe, expect, it } from 'vitest';
import { parseSystemAccentColor, parseWorkerUiPreferences } from './workerUiPreferences';

const validPreferences = {
  shopId: '11111111-1111-4111-8111-111111111111',
  workerId: '22222222-2222-4222-8222-222222222222',
  categoryOrder: ['33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332'],
  categoryAlignment: 'center',
  productOrder: ['44444444-4444-4444-8444-444444444441', '44444444-4444-4444-8444-444444444442'],
  accentColor: null,
  updatedAt: '2026-08-25T02:00:00.000Z',
  serverVersion: 4,
  syncState: 'DIRTY',
} as const;

describe('parseSystemAccentColor', () => {
  it('normalizes valid six-digit colors to canonical uppercase HEX', () => {
    expect(parseSystemAccentColor('#1e3a8a')).toBe('#1E3A8A');
    expect(parseSystemAccentColor('#ABCDEF')).toBe('#ABCDEF');
  });

  it.each(['#12345', '#1234567', '1E3A8A', '#GG0000', '', 42, null, undefined])(
    'rejects invalid persisted accent %p',
    (value) => expect(() => parseSystemAccentColor(value)).toThrow(TypeError),
  );
});

describe('parseWorkerUiPreferences', () => {
  it('validates and rehydrates worker UI preferences including product order and accent', () => {
    expect(parseWorkerUiPreferences(validPreferences)).toEqual(validPreferences);
  });

  it('normalizes a persisted worker accent', () => {
    expect(parseWorkerUiPreferences({ ...validPreferences, accentColor: '#1e3a8a' }).accentColor).toBe(
      '#1E3A8A',
    );
  });

  it('keeps older persisted preferences backward compatible by defaulting product order and accent', () => {
    const legacyPreferences = {
      shopId: validPreferences.shopId,
      workerId: validPreferences.workerId,
      categoryOrder: validPreferences.categoryOrder,
      categoryAlignment: validPreferences.categoryAlignment,
      updatedAt: validPreferences.updatedAt,
      serverVersion: validPreferences.serverVersion,
      syncState: validPreferences.syncState,
    } as const;

    expect(parseWorkerUiPreferences(legacyPreferences)).toEqual({
      ...legacyPreferences,
      productOrder: [],
      accentColor: null,
    });
  });

  it('treats an explicit null accent as the TUX default', () => {
    expect(parseWorkerUiPreferences({ ...validPreferences, accentColor: null }).accentColor).toBeNull();
  });

  it.each(['top', '', 'CENTER'])('rejects invalid category alignment %s', (categoryAlignment) => {
    expect(() => parseWorkerUiPreferences({ ...validPreferences, categoryAlignment })).toThrow(
      'categoryAlignment',
    );
  });

  it('rejects duplicate category IDs', () => {
    expect(() =>
      parseWorkerUiPreferences({
        ...validPreferences,
        categoryOrder: [validPreferences.categoryOrder[0], validPreferences.categoryOrder[0]],
      }),
    ).toThrow('categoryOrder');
  });

  it('rejects duplicate product IDs', () => {
    expect(() =>
      parseWorkerUiPreferences({
        ...validPreferences,
        productOrder: [validPreferences.productOrder[0], validPreferences.productOrder[0]],
      }),
    ).toThrow('productOrder');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid serverVersion %s',
    (serverVersion) => {
      expect(() => parseWorkerUiPreferences({ ...validPreferences, serverVersion })).toThrow(
        'serverVersion',
      );
    },
  );

  it.each(['PENDING', '', 'dirty'])('rejects invalid sync state %s', (syncState) => {
    expect(() => parseWorkerUiPreferences({ ...validPreferences, syncState })).toThrow('syncState');
  });
});
