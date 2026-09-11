import { parseOperationsConfigurationBundle } from '../../../packages/domain/src/configurationBundle.ts';

import type { OnlineOrderPublishedCheckoutAuthority } from './order-intake.ts';

function minimumOrderMinor(values: Readonly<Record<string, unknown>>): number {
  const value = values['checkout.minimumOrderMinor'];
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('published checkout.minimumOrderMinor is invalid');
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
    minimumOrderMinor: minimumOrderMinor(settings?.values ?? {}),
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
