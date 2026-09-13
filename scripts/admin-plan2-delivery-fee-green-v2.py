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
    ".github/workflows/admin-catalog-settings-tdd.yml",
    "          packages/domain/src/checkoutPolicyStacking.test.ts\n          packages/domain/src/checkoutSnapshotSync.test.ts",
    "          packages/domain/src/checkoutPolicyStacking.test.ts\n          packages/domain/src/deliveryFeePolicy.test.ts\n          packages/domain/src/checkoutSnapshotSync.test.ts",
)
replace_once(
    ".github/workflows/admin-catalog-settings-tdd.yml",
    "          apps/operations/src/app/paymentReferenceUi.test.ts\n          apps/operations/src/app/OnlineOrderInboxPanel.test.tsx",
    "          apps/operations/src/app/paymentReferenceUi.test.ts\n          apps/operations/src/app/deliveryFeePolicyUi.test.ts\n          apps/operations/src/app/OnlineOrderInboxPanel.test.tsx",
)
