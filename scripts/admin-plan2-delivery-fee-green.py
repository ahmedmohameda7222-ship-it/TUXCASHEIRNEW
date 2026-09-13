from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "packages/domain/src/checkoutPolicy.ts",
    "  readonly allowDiscountStacking: boolean;\n}",
    "  readonly allowDiscountStacking: boolean;\n  readonly allowDeliveryFeeOverride: boolean;\n}",
)
replace_once(
    "packages/domain/src/checkoutPolicy.ts",
    "  key: 'checkout.allowDiscountStacking',",
    "  key: 'checkout.allowDiscountStacking' | 'checkout.allowDeliveryFeeOverride',",
)
replace_once(
    "packages/domain/src/checkoutPolicy.ts",
    "    allowDiscountStacking: booleanSetting(configuration, 'checkout.allowDiscountStacking', false),\n  };",
    "    allowDiscountStacking: booleanSetting(configuration, 'checkout.allowDiscountStacking', false),\n    allowDeliveryFeeOverride: booleanSetting(\n      configuration,\n      'checkout.allowDeliveryFeeOverride',\n      false,\n    ),\n  };",
)

replace_once(
    "packages/domain/src/orderValidation.ts",
    "  | 'delivery.address'\n  | 'discount'",
    "  | 'delivery.address'\n  | 'delivery.fee'\n  | 'discount'",
)
replace_once(
    "packages/domain/src/orderValidation.ts",
    "  let normalizedDeliveryPhone: string | null = null;\n  if (orderType?.behavior === 'DELIVERY') {",
    "  let normalizedDeliveryPhone: string | null = null;\n  const activeDeliveryZone =\n    orderType?.behavior === 'DELIVERY' && draft.delivery.zoneId !== null\n      ? configuration.deliveryZones.find(\n          (candidate) => candidate.id === draft.delivery.zoneId && candidate.active,\n        )\n      : undefined;\n  if (orderType?.behavior === 'DELIVERY') {",
)
replace_once(
    "packages/domain/src/orderValidation.ts",
    "    if (draft.delivery.zoneId === null) {\n      issues.push({\n        path: 'delivery.zone',\n        code: 'DELIVERY_ZONE_REQUIRED',\n        message: 'Delivery Zone is required.',\n      });\n    }",
    "    if (draft.delivery.zoneId === null) {\n      issues.push({\n        path: 'delivery.zone',\n        code: 'DELIVERY_ZONE_REQUIRED',\n        message: 'Delivery Zone is required.',\n      });\n    } else if (activeDeliveryZone === undefined) {\n      issues.push({\n        path: 'delivery.zone',\n        code: 'DELIVERY_ZONE_UNAVAILABLE',\n        message: 'Choose an available delivery zone.',\n      });\n    } else if (draft.delivery.configuredFeeMinor !== activeDeliveryZone.feeMinor) {\n      issues.push({\n        path: 'delivery.fee',\n        code: 'DELIVERY_ZONE_FEE_STALE',\n        message: 'The delivery zone fee changed. Re-select the delivery zone.',\n      });\n    }",
)
replace_once(
    "packages/domain/src/orderValidation.ts",
    "    checkoutPolicy = resolveEffectiveCheckoutPolicy(configuration);\n    pricing = calculateCheckoutPricing({",
    "    checkoutPolicy = resolveEffectiveCheckoutPolicy(configuration);\n    if (\n      orderType?.behavior === 'DELIVERY' &&\n      activeDeliveryZone !== undefined &&\n      !checkoutPolicy.allowDeliveryFeeOverride &&\n      draft.delivery.finalFeeMinor !== activeDeliveryZone.feeMinor\n    ) {\n      issues.push({\n        path: 'delivery.fee',\n        code: 'DELIVERY_FEE_OVERRIDE_NOT_ALLOWED',\n        message: 'The published checkout policy requires the configured delivery zone fee.',\n      });\n    }\n    pricing = calculateCheckoutPricing({",
)

replace_once(
    "packages/domain/src/models.ts",
    "  readonly allowDiscountStacking?: boolean;\n  readonly serviceChargeBps: number;",
    "  readonly allowDiscountStacking?: boolean;\n  /** Present on new checkout snapshots; omitted by legacy persisted orders. */\n  readonly allowDeliveryFeeOverride?: boolean;\n  readonly serviceChargeBps: number;",
)
replace_once(
    "packages/domain/src/syncContract.ts",
    "    allowDiscountStacking:\n      source['allowDiscountStacking'] === undefined\n        ? false\n        : booleanValue(source['allowDiscountStacking'], 'checkout allowDiscountStacking'),\n    serviceChargeBps,",
    "    allowDiscountStacking:\n      source['allowDiscountStacking'] === undefined\n        ? false\n        : booleanValue(source['allowDiscountStacking'], 'checkout allowDiscountStacking'),\n    ...(source['allowDeliveryFeeOverride'] === undefined\n      ? {}\n      : {\n          allowDeliveryFeeOverride: booleanValue(\n            source['allowDeliveryFeeOverride'],\n            'checkout allowDeliveryFeeOverride',\n          ),\n        }),\n    serviceChargeBps,",
)
replace_once(
    "packages/domain/src/order.ts",
    "    if (snapshot.minimumOrderSatisfied !== order.itemsSubtotalMinor >= snapshot.minimumOrderMinor) {",
    "    if (\n      snapshot.allowDeliveryFeeOverride === false &&\n      order.fulfillment.behavior === 'DELIVERY' &&\n      order.fulfillment.delivery.finalFeeMinor !== order.fulfillment.delivery.configuredFeeMinor\n    ) {\n      throw new DomainInvariantError(\n        'Checkout delivery fee override conflicts with the immutable checkout policy.',\n      );\n    }\n    if (snapshot.minimumOrderSatisfied !== order.itemsSubtotalMinor >= snapshot.minimumOrderMinor) {",
)

replace_once(
    "packages/application/src/orders.ts",
    "                allowDiscountStacking: validation.value.checkoutPolicy.allowDiscountStacking,\n                serviceChargeBps:",
    "                allowDiscountStacking: validation.value.checkoutPolicy.allowDiscountStacking,\n                allowDeliveryFeeOverride:\n                  validation.value.checkoutPolicy.allowDeliveryFeeOverride,\n                serviceChargeBps:",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.ts",
    "  let delivery: OrderDraft['delivery'];\n  let deliveryFeeMinor = moneyMinor(0);",
    "  const checkoutPolicy = resolveEffectiveCheckoutPolicy(workspace.configuration);\n  let delivery: OrderDraft['delivery'];\n  let deliveryFeeMinor = moneyMinor(0);",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.ts",
    "    if (zone === undefined) fail('The worker-confirmed delivery zone is unavailable.');\n    if (confirmation.finalDeliveryFeeMinor < 0) fail('The final delivery fee is invalid.');\n    deliveryFeeMinor = confirmation.finalDeliveryFeeMinor;",
    "    if (zone === undefined) fail('The worker-confirmed delivery zone is unavailable.');\n    if (confirmation.finalDeliveryFeeMinor < 0) fail('The final delivery fee is invalid.');\n    if (\n      !checkoutPolicy.allowDeliveryFeeOverride &&\n      confirmation.finalDeliveryFeeMinor !== zone.feeMinor\n    ) {\n      fail('The published checkout policy requires the configured delivery zone fee.');\n    }\n    deliveryFeeMinor = confirmation.finalDeliveryFeeMinor;",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.ts",
    "  const checkoutPolicy = resolveEffectiveCheckoutPolicy(workspace.configuration);\n  const pricing = calculateCheckoutPricing({",
    "  const pricing = calculateCheckoutPricing({",
)

replace_once(
    "apps/admin/api/admin/settings.ts",
    "  'checkout.allowDiscountStacking': z.boolean(),\n  'checkout.requireCustomerPhone': z.boolean(),",
    "  'checkout.allowDiscountStacking': z.boolean(),\n  'checkout.allowDeliveryFeeOverride': z.boolean(),\n  'checkout.requireCustomerPhone': z.boolean(),",
)
replace_once(
    "apps/admin/src/settings/CheckoutPage.tsx",
    "        <SettingOverrideEditor\n          workspace={workspace}\n          settingKey=\"checkout.allowDiscountStacking\"\n          label=\"Allow discount stacking\"\n          kind=\"boolean\"\n          help=\"Future promotion and loyalty calculations use this published policy; existing orders keep their checkout snapshot.\"\n          updating={updating}\n          onUpdate={onUpdate}\n        />",
    "        <SettingOverrideEditor\n          workspace={workspace}\n          settingKey=\"checkout.allowDiscountStacking\"\n          label=\"Allow discount stacking\"\n          kind=\"boolean\"\n          help=\"Future promotion and loyalty calculations use this published policy; existing orders keep their checkout snapshot.\"\n          updating={updating}\n          onUpdate={onUpdate}\n        />\n        <SettingOverrideEditor\n          workspace={workspace}\n          settingKey=\"checkout.allowDeliveryFeeOverride\"\n          label=\"Allow delivery fee override\"\n          kind=\"boolean\"\n          help=\"When off, Delivery orders must use the published zone fee. Existing orders keep their checkout snapshot.\"\n          updating={updating}\n          onUpdate={onUpdate}\n        />",
)

replace_once(
    "apps/operations/src/app/OrdersCart.tsx",
    "  const delivery = selectedOrderType?.behavior === 'DELIVERY';\n  const methods = activePaymentMethods(configuration);",
    "  const delivery = selectedOrderType?.behavior === 'DELIVERY';\n  const allowDeliveryFeeOverride =\n    configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true;\n  const methods = activePaymentMethods(configuration);",
)
replace_once(
    "apps/operations/src/app/OrdersCart.tsx",
    "              paths={['delivery.phone', 'delivery.name', 'delivery.zone', 'delivery.address']}",
    "              paths={[\n                'delivery.phone',\n                'delivery.name',\n                'delivery.zone',\n                'delivery.address',\n                'delivery.fee',\n              ]}",
)
replace_once(
    "apps/operations/src/app/OrdersCart.tsx",
    "                value={draft.delivery.finalFeeMinor}\n                disabled={busy}\n                compact",
    "                value={draft.delivery.finalFeeMinor}\n                disabled={busy || !allowDeliveryFeeOverride}\n                compact",
)

replace_once(
    "apps/operations/src/app/OnlineOrderInboxPanel.tsx",
    "function fulfillmentLabel(request: CachedOnlineOrderRequest): string {",
    "function minorInput(minor: MoneyMinor): string {\n  const whole = Math.floor(minor / 100);\n  const fraction = String(minor % 100).padStart(2, '0');\n  return fraction === '00' ? String(whole) : `${whole}.${fraction}`;\n}\n\nfunction fulfillmentLabel(request: CachedOnlineOrderRequest): string {",
)
replace_once(
    "apps/operations/src/app/OnlineOrderInboxPanel.tsx",
    "  const selectedPayment = paymentMethods.find((method) => method.id === paymentMethodId) ?? null;\n  const finalFeeMinor =",
    "  const selectedPayment = paymentMethods.find((method) => method.id === paymentMethodId) ?? null;\n  const allowDeliveryFeeOverride =\n    workspace.configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true;\n  const finalFeeMinor =",
)
replace_once(
    "apps/operations/src/app/OnlineOrderInboxPanel.tsx",
    "                value={deliveryZoneId}\n                onChange={(event) => setDeliveryZoneId(event.target.value)}",
    "                value={deliveryZoneId}\n                onChange={(event) => {\n                  const nextZoneId = event.target.value;\n                  setDeliveryZoneId(nextZoneId);\n                  const nextZone = deliveryZones.find((zone) => zone.id === nextZoneId);\n                  setFinalDeliveryFee(nextZone === undefined ? '' : minorInput(nextZone.feeMinor));\n                }}",
)
replace_once(
    "apps/operations/src/app/OnlineOrderInboxPanel.tsx",
    "                value={finalDeliveryFee}\n                onChange={(event) => setFinalDeliveryFee(event.target.value)}",
    "                value={finalDeliveryFee}\n                disabled={busy || !allowDeliveryFeeOverride}\n                onChange={(event) => setFinalDeliveryFee(event.target.value)}",
)

replace_once(
    "packages/domain/src/checkoutSnapshotSync.test.ts",
    "      allowDiscountStacking: true,\n      serviceChargeBps:",
    "      allowDiscountStacking: true,\n      allowDeliveryFeeOverride: true,\n      serviceChargeBps:",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.test.ts",
    "function deliveryConfirmation(cashReceivedMinor = 25_000) {\n  return {\n    orderTypeId: DELIVERY_ID,\n    deliveryZoneId: ZONE_ID,\n    finalDeliveryFeeMinor: moneyMinor(2_500),",
    "function deliveryConfirmation(cashReceivedMinor = 25_000, finalDeliveryFeeMinor = 3_000) {\n  return {\n    orderTypeId: DELIVERY_ID,\n    deliveryZoneId: ZONE_ID,\n    finalDeliveryFeeMinor: moneyMinor(finalDeliveryFeeMinor),",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.test.ts",
    "      configuredFeeMinor: moneyMinor(3_000),\n      finalFeeMinor: moneyMinor(2_500),",
    "      configuredFeeMinor: moneyMinor(3_000),\n      finalFeeMinor: moneyMinor(3_000),",
)
replace_once(
    "packages/application/src/onlineOrderAcceptance.test.ts",
    "  it('refuses stale trusted prices instead of silently accepting an old catalog snapshot', () => {",
    "  it('rejects a delivery-fee override when the published policy is disabled', () => {\n    expect(() =>\n      prepareOnlineOrderAcceptanceDraft({\n        request: request(),\n        workspace: workspace(\n          configurationWithCheckout({ 'checkout.allowDeliveryFeeOverride': false }),\n        ),\n        confirmation: deliveryConfirmation(25_000, 2_500),\n        runtime,\n      }),\n    ).toThrow(/configured delivery zone fee|checkout policy/i);\n  });\n\n  it('allows a delivery-fee override only when the published policy enables it', () => {\n    const draft = prepareOnlineOrderAcceptanceDraft({\n      request: request(),\n      workspace: workspace(\n        configurationWithCheckout({ 'checkout.allowDeliveryFeeOverride': true }),\n      ),\n      confirmation: deliveryConfirmation(25_000, 2_500),\n      runtime,\n    });\n\n    expect(draft.delivery.finalFeeMinor).toBe(moneyMinor(2_500));\n    expect(draft.delivery.configuredFeeMinor).toBe(moneyMinor(3_000));\n  });\n\n  it('refuses stale trusted prices instead of silently accepting an old catalog snapshot', () => {",
)

replace_once(
    "apps/admin/api/admin/settings.test.ts",
    "    expect(\n      settingsCommandSchema.safeParse({\n        type: 'setting.override.upsert',\n        shopId,\n        settingKey: 'receipt.orderPrefix',\n        value: 'MD-',\n        expectedVersion: 2,\n      }).success,\n    ).toBe(true);",
    "    expect(\n      settingsCommandSchema.safeParse({\n        type: 'setting.override.upsert',\n        shopId,\n        settingKey: 'receipt.orderPrefix',\n        value: 'MD-',\n        expectedVersion: 2,\n      }).success,\n    ).toBe(true);\n    expect(\n      settingsCommandSchema.safeParse({\n        type: 'setting.override.upsert',\n        shopId,\n        settingKey: 'checkout.allowDeliveryFeeOverride',\n        value: true,\n        expectedVersion: null,\n      }).success,\n    ).toBe(true);",
)
replace_once(
    "apps/admin/api/admin/settings.test.ts",
    "    expect(\n      settingsCommandSchema.safeParse({\n        ...base,\n        settingKey: 'checkout.requireCustomerPhone',\n        value: 1,\n      }).success,\n    ).toBe(false);",
    "    expect(\n      settingsCommandSchema.safeParse({\n        ...base,\n        settingKey: 'checkout.requireCustomerPhone',\n        value: 1,\n      }).success,\n    ).toBe(false);\n    expect(\n      settingsCommandSchema.safeParse({\n        ...base,\n        settingKey: 'checkout.allowDeliveryFeeOverride',\n        value: 1,\n      }).success,\n    ).toBe(false);",
)

replace_once(
    "scripts/test-admin-settings-schema-hardening.mjs",
    "const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();",
    "const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();\nconst deliveryFeePolicyMigrationPath =\n  'supabase/migrations/20260910121000_admin_delivery_fee_override_policy.sql';\nif (!fs.existsSync(deliveryFeePolicyMigrationPath)) {\n  throw new Error(`Delivery fee override migration is missing: ${deliveryFeePolicyMigrationPath}`);\n}\nconst deliveryFeePolicySql = fs.readFileSync(deliveryFeePolicyMigrationPath, 'utf8').toLowerCase();\nif (\n  !deliveryFeePolicySql.includes('validate_admin_setting_value_v1') ||\n  !deliveryFeePolicySql.includes('checkout.allowdeliveryfeeoverride')\n) {\n  throw new Error('Delivery fee override migration does not extend the reviewed setting validator');\n}",
)
replace_once(
    "scripts/test-admin-settings-schema-hardening.mjs",
    "  v_result := public.upsert_shop_setting_override_v1(\n    '${ownerId}', '${shopId}', 'receipt.orderPrefix', '\\"MD-\\"'::jsonb, null\n  );\n  if coalesce((v_result ->> 'ok')::boolean, false) is not true then\n    raise exception 'valid receipt prefix rejected: %', v_result;\n  end if;",
    "  v_result := public.upsert_shop_setting_override_v1(\n    '${ownerId}', '${shopId}', 'receipt.orderPrefix', '\\"MD-\\"'::jsonb, null\n  );\n  if coalesce((v_result ->> 'ok')::boolean, false) is not true then\n    raise exception 'valid receipt prefix rejected: %', v_result;\n  end if;\n\n  v_result := public.upsert_shop_setting_override_v1(\n    '${ownerId}', '${shopId}', 'checkout.allowDeliveryFeeOverride', 'true'::jsonb, null\n  );\n  if coalesce((v_result ->> 'ok')::boolean, false) is not true then\n    raise exception 'valid delivery fee override policy rejected: %', v_result;\n  end if;\n\n  v_result := public.upsert_shop_setting_override_v1(\n    '${ownerId}', '${shopId}', 'checkout.allowDeliveryFeeOverride', '1'::jsonb, null\n  );\n  if v_result ->> 'code' <> 'invalid_setting' then\n    raise exception 'non-boolean delivery fee override policy was accepted: %', v_result;\n  end if;",
)

replace_once(
    ".github/workflows/admin-catalog-settings-tdd.yml",
    "          packages/domain/src/checkoutPolicyStacking.test.ts\n          packages/domain/src/checkoutSnapshotSync.test.ts",
    "          packages/domain/src/checkoutPolicyStacking.test.ts\n          packages/domain/src/deliveryFeePolicy.test.ts\n          packages/domain/src/checkoutSnapshotSync.test.ts",
)
replace_once(
    ".github/workflows/admin-catalog-settings-tdd.yml",
    "          apps/operations/src/app/paymentReferenceUi.test.ts\n          apps/operations/src/app/OnlineOrderInboxPanel.test.tsx",
    "          apps/operations/src/app/paymentReferenceUi.test.ts\n          apps/operations/src/app/deliveryFeePolicyUi.test.ts\n          apps/operations/src/app/OnlineOrderInboxPanel.test.tsx",
)

Path("packages/domain/src/deliveryFeePolicy.test.ts").write_text(
    """import { describe, expect, it } from 'vitest';
import type { OperationsConfigurationSnapshot } from './catalog';
import type { OrderDraft } from './orderDraft';
import { moneyMinor } from './money';
import { validateOrderDraft } from './orderValidation';

const shopId = '10000000-0000-4000-8000-000000000001' as never;
const categoryId = '11000000-0000-4000-8000-000000000001' as never;
const productId = '12000000-0000-4000-8000-000000000001' as never;
const lineId = '13000000-0000-4000-8000-000000000001' as never;
const orderTypeId = '20000000-0000-4000-8000-000000000001' as never;
const zoneId = '30000000-0000-4000-8000-000000000001' as never;
const paymentMethodId = '31000000-0000-4000-8000-000000000001' as never;

function config(allowDeliveryFeeOverride?: boolean): OperationsConfigurationSnapshot {
  return {
    shopId,
    version: 9,
    updatedAt: '2026-09-13T00:00:00.000Z' as never,
    categories: [],
    products: [{ id: productId, shopId, categoryId, name: 'Burger', description: null, priceMinor: moneyMinor(1_000), imageKey: null, active: true, soldOut: false, isCombo: false, sortOrder: 1 }],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [{ id: orderTypeId, shopId, name: 'Delivery', behavior: 'DELIVERY', active: true, sortOrder: 1 }],
    paymentMethods: [{ id: paymentMethodId, shopId, displayName: 'Cash', logicType: 'CASH', requiresReconciliation: true, active: true, sortOrder: 1, channel: 'BOTH' }],
    deliveryZones: [{ id: zoneId, shopId, name: 'Zone', feeMinor: moneyMinor(2_000), active: true, sortOrder: 1 }],
    settings: { version: 4, values: allowDeliveryFeeOverride === undefined ? {} : { 'checkout.allowDeliveryFeeOverride': allowDeliveryFeeOverride } } as never,
    reasonCodes: [],
  };
}

function draft(finalFeeMinor: number, configuredFeeMinor = 2_000): OrderDraft {
  return {
    shopId,
    businessDayId: '40000000-0000-4000-8000-000000000001' as never,
    draftScopeId: 'delivery-fee-policy',
    revision: 1,
    updatedAt: '2026-09-13T00:00:00.000Z' as never,
    checkoutIntentKey: '50000000-0000-4000-8000-000000000001',
    orderTypeId,
    lines: [{ id: lineId, productId, productName: 'Burger', unitPriceMinor: moneyMinor(1_000), quantity: 1, modifiers: [], comboBeverages: [], itemNote: null, addedSequence: 1 }],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: { displayPhone: '01012345678', normalizedPhone: '01012345678', customerName: 'Customer', address: 'Address', zoneId, zoneLabel: 'Zone', configuredFeeMinor: moneyMinor(configuredFeeMinor), finalFeeMinor: moneyMinor(finalFeeMinor) },
    payment: { mode: 'SINGLE', methodId: paymentMethodId, cashReceivedMinor: moneyMinor(4_000) },
  };
}

function issueCodes(result: ReturnType<typeof validateOrderDraft>): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.code);
}

describe('delivery fee override authority', () => {
  it('fails closed when the policy is absent', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000), config()))).toContain('DELIVERY_FEE_OVERRIDE_NOT_ALLOWED');
  });

  it('rejects a fee different from the configured zone fee when override policy is disabled', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000), config(false)))).toContain('DELIVERY_FEE_OVERRIDE_NOT_ALLOWED');
  });

  it('allows a manual delivery fee only when the published policy enables it', () => {
    expect(validateOrderDraft(draft(3_000), config(true)).valid).toBe(true);
  });

  it('rejects a stale draft configured fee even when overrides are enabled', () => {
    expect(issueCodes(validateOrderDraft(draft(3_000, 1_500), config(true)))).toContain('DELIVERY_ZONE_FEE_STALE');
  });
});
"""
)

Path("apps/operations/src/app/deliveryFeePolicyUi.test.ts").write_text(
    """import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersCart = readFileSync(new URL('./OrdersCart.tsx', import.meta.url), 'utf8');
const onlineInbox = readFileSync(new URL('./OnlineOrderInboxPanel.tsx', import.meta.url), 'utf8');

describe('delivery fee policy UI authority', () => {
  it('fails closed for POS manual delivery-fee editing', () => {
    expect(ordersCart).toContain("configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true");
    expect(ordersCart).toContain('disabled={busy || !allowDeliveryFeeOverride}');
    expect(ordersCart).toContain("'delivery.fee'");
  });

  it('defaults online acceptance to the selected zone fee and disables manual editing unless allowed', () => {
    expect(onlineInbox).toContain("workspace.configuration.settings?.values['checkout.allowDeliveryFeeOverride'] === true");
    expect(onlineInbox).toContain("setFinalDeliveryFee(nextZone === undefined ? '' : minorInput(nextZone.feeMinor))");
    expect(onlineInbox).toContain('disabled={busy || !allowDeliveryFeeOverride}');
  });
});
"""
)

Path("supabase/migrations/20260910121000_admin_delivery_fee_override_policy.sql").write_text(
    """-- TUX Admin Plan 2 delivery-fee override authority.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Manual delivery-fee overrides are fail-closed unless this reviewed boolean setting is published.

create or replace function private.validate_admin_setting_value_v1(
  p_setting_key text,
  p_value_json jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_number numeric;
  v_text text;
begin
  if p_setting_key is null or p_value_json is null then
    return false;
  end if;

  case p_setting_key
    when 'checkout.minimumOrderMinor' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 9007199254740991;

    when 'checkout.serviceChargeBps', 'checkout.taxBps' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 10000;

    when 'checkout.requireCustomerPhone',
         'checkout.allowScheduledOrders',
         'checkout.allowDiscountStacking',
         'checkout.allowDeliveryFeeOverride' then
      return jsonb_typeof(p_value_json) = 'boolean';

    when 'receipt.orderPrefix' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 64;

    when 'receipt.footer' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 1000;

    when 'receipt.sequenceStart' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 1 and 9007199254740991;

    when 'receipt.sequenceResetPolicy' then
      return jsonb_typeof(p_value_json) = 'string'
        and (p_value_json #>> '{}') = 'BUSINESS_DAY';

    else
      return false;
  end case;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.validate_admin_setting_value_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.validate_admin_setting_value_v1(text, jsonb)
  to service_role;
"""
)
