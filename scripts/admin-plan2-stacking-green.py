from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    file.write_text(source.replace(old, new, 1))


replace(
    "packages/domain/src/models.ts",
    "  readonly allowDiscountStacking: boolean;\n",
    "  /** Present on new checkout snapshots; omitted by legacy persisted orders. */\n  readonly allowDiscountStacking?: boolean;\n",
)

replace(
    "packages/application/src/orders.ts",
    "                minimumOrderSatisfied: true,\n                serviceChargeBps: validation.value.checkoutPolicy.serviceChargeBps,",
    "                minimumOrderSatisfied: true,\n                allowDiscountStacking: validation.value.checkoutPolicy.allowDiscountStacking,\n                serviceChargeBps: validation.value.checkoutPolicy.serviceChargeBps,",
)

replace(
    "packages/domain/src/syncContract.ts",
    "    minimumOrderSatisfied: booleanValue(\n      source['minimumOrderSatisfied'],\n      'checkout minimumOrderSatisfied',\n    ),\n    serviceChargeBps,",
    "    minimumOrderSatisfied: booleanValue(\n      source['minimumOrderSatisfied'],\n      'checkout minimumOrderSatisfied',\n    ),\n    allowDiscountStacking:\n      source['allowDiscountStacking'] === undefined\n        ? false\n        : booleanValue(source['allowDiscountStacking'], 'checkout allowDiscountStacking'),\n    serviceChargeBps,",
)

replace(
    "packages/domain/src/checkoutSnapshotSync.test.ts",
    "      minimumOrderSatisfied: true,\n      serviceChargeBps: 1_000,",
    "      minimumOrderSatisfied: true,\n      allowDiscountStacking: true,\n      serviceChargeBps: 1_000,",
)

replace(
    "apps/admin/src/settings/CheckoutPage.tsx",
    '''        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.allowScheduledOrders"
          label="Scheduled orders"
          kind="boolean"
          updating={updating}
          onUpdate={onUpdate}
        />
''',
    '''        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.allowScheduledOrders"
          label="Scheduled orders"
          kind="boolean"
          updating={updating}
          onUpdate={onUpdate}
        />
        <SettingOverrideEditor
          workspace={workspace}
          settingKey="checkout.allowDiscountStacking"
          label="Allow discount stacking"
          kind="boolean"
          help="Future promotion and loyalty calculations use this published policy; existing orders keep their checkout snapshot."
          updating={updating}
          onUpdate={onUpdate}
        />
''',
)

replace(
    "apps/admin/src/settings/SettingsPage.test.tsx",
    "    { key: 'checkout.allowScheduledOrders', value: false, version: 1 },\n",
    "    { key: 'checkout.allowScheduledOrders', value: false, version: 1 },\n    { key: 'checkout.allowDiscountStacking', value: true, version: 1 },\n",
)
replace(
    "apps/admin/src/settings/SettingsPage.test.tsx",
    "    expect(checkout).toContain('Save Tax / VAT (bps)');\n",
    "    expect(checkout).toContain('Save Tax / VAT (bps)');\n    expect(checkout).toContain('Allow discount stacking');\n    expect(checkout).toContain('Save Allow discount stacking');\n",
)

replace(
    "packages/catalog-contracts/src/index.ts",
    "  readonly taxBps?: number;\n  readonly fulfillmentPreferences:",
    "  readonly taxBps?: number;\n  readonly allowDiscountStacking?: boolean;\n  readonly fulfillmentPreferences:",
)
replace(
    "packages/catalog-contracts/src/index.ts",
    "      'taxBps',\n      'fulfillmentPreferences',",
    "      'taxBps',\n      'allowDiscountStacking',\n      'fulfillmentPreferences',",
)
replace(
    "packages/catalog-contracts/src/index.ts",
    "    taxBps: basisPointsOrDefault(row.taxBps, `${path}.taxBps`),\n    fulfillmentPreferences:",
    "    taxBps: basisPointsOrDefault(row.taxBps, `${path}.taxBps`),\n    allowDiscountStacking:\n      row.allowDiscountStacking === undefined\n        ? false\n        : requiredBoolean(row.allowDiscountStacking, `${path}.allowDiscountStacking`),\n    fulfillmentPreferences:",
)

replace(
    "supabase/functions/catalog-public/published-ordering.ts",
    "function isOnlinePaymentMethod(method: {",
    '''function booleanSetting(
  values: Readonly<Record<string, unknown>>,
  key: 'checkout.allowDiscountStacking',
  fallback = false,
): boolean {
  const value = values[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`published ${key} is invalid`);
  return value;
}

function isOnlinePaymentMethod(method: {''',
)
replace(
    "supabase/functions/catalog-public/published-ordering.ts",
    "      taxBps: nonNegativeIntegerSetting(settings.values, 'checkout.taxBps', 10_000),\n      fulfillmentPreferences,",
    "      taxBps: nonNegativeIntegerSetting(settings.values, 'checkout.taxBps', 10_000),\n      allowDiscountStacking: booleanSetting(\n        settings.values,\n        'checkout.allowDiscountStacking',\n      ),\n      fulfillmentPreferences,",
)

replace(
    "supabase/functions/catalog-public/published-ordering.test.ts",
    "                'checkout.taxBps': 1400,\n",
    "                'checkout.taxBps': 1400,\n                'checkout.allowDiscountStacking': true,\n",
)
replace(
    "supabase/functions/catalog-public/published-ordering.test.ts",
    "        taxBps: 1400,\n        fulfillmentPreferences:",
    "        taxBps: 1400,\n        allowDiscountStacking: true,\n        fulfillmentPreferences:",
)

replace(
    "packages/catalog-contracts/src/publicOrderingProjection.test.ts",
    "      taxBps: 1400,\n      fulfillmentPreferences:",
    "      taxBps: 1400,\n      allowDiscountStacking: true,\n      fulfillmentPreferences:",
)
replace(
    "packages/catalog-contracts/src/publicOrderingProjection.test.ts",
    "  it.each([\n",
    '''  it('defaults an omitted legacy stacking policy to false and rejects malformed values', () => {
    const snapshot = validSnapshotV2();
    const legacyOrdering = { ...snapshot.ordering } as Record<string, unknown>;
    delete legacyOrdering.allowDiscountStacking;
    expect(
      parsePublicCatalogSnapshotV2({ ...snapshot, ordering: legacyOrdering }).ordering
        .allowDiscountStacking,
    ).toBe(false);
    expect(() =>
      parsePublicCatalogSnapshotV2({
        ...snapshot,
        ordering: { ...snapshot.ordering, allowDiscountStacking: 'yes' },
      }),
    ).toThrow(/allowDiscountStacking/);
  });

  it.each([
''',
)
