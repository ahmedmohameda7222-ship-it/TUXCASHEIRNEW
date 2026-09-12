import { parseOperationsConfigurationBundle } from '../../../packages/domain/src/configurationBundle.ts';

import type { OnlineOrderPublishedCheckoutAuthority } from './order-intake.ts';

function nonNegativeIntegerSetting(
  values: Readonly<Record<string, unknown>>,
  key: 'checkout.minimumOrderMinor' | 'checkout.serviceChargeBps' | 'checkout.taxBps',
  maximum: number,
): number {
  const value = values[key];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`published ${key} is invalid`);
  }
  return value;
}

export function projectPublishedCheckoutAuthority(
  bundleJson: unknown,
  expectedShopId: string,
): OnlineOrderPublishedCheckoutAuthority {
  const { snapshot } = parseOperationsConfigurationBundle(bundleJson);
  if (snapshot.shopId !== expectedShopId) {
    throw new TypeError('published Operations configuration belongs to a different shop');
  }

  const settings = snapshot.settings ?? null;
  return {
    shopId: snapshot.shopId,
    configurationVersion: snapshot.version,
    settingsVersion: settings?.version ?? null,
    lifecycleState: settings?.shopIdentity.lifecycleState ?? 'ACTIVE',
    temporaryClosed: settings?.shopIdentity.temporaryClosed ?? false,
    onlineOrdersPaused: settings?.shopIdentity.onlineOrdersPaused ?? false,
    minimumOrderMinor: nonNegativeIntegerSetting(
      settings?.values ?? {},
      'checkout.minimumOrderMinor',
      Number.MAX_SAFE_INTEGER,
    ),
    serviceChargeBps: nonNegativeIntegerSetting(
      settings?.values ?? {},
      'checkout.serviceChargeBps',
      10_000,
    ),
    taxBps: nonNegativeIntegerSetting(settings?.values ?? {}, 'checkout.taxBps', 10_000),
    orderTypes: snapshot.orderTypes.map((orderType) => ({
      behavior: orderType.behavior,
      active: orderType.active,
    })),
    paymentMethods: snapshot.paymentMethods.map((paymentMethod) => ({
      id: paymentMethod.id,
      displayName: paymentMethod.displayName,
      logicType: paymentMethod.logicType,
      active: paymentMethod.active,
      channel: paymentMethod.channel ?? 'BOTH',
      integrationReference: paymentMethod.integrationReference ?? null,
    })),
  };
}
