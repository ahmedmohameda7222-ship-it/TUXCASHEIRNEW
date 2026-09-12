import type {
  PublicCatalogShopV2,
  PublicFulfillmentPreferenceV2,
  PublicOrderingV2,
  PublicPaymentPreferenceV2,
} from '../../../packages/catalog-contracts/src/index.ts';
import { parseOperationsConfigurationBundle } from '../../../packages/domain/src/configurationBundle.ts';

export interface PublishedPublicOrderingProjection {
  readonly shop: PublicCatalogShopV2;
  readonly ordering: PublicOrderingV2;
}

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

function isOnlinePaymentMethod(method: {
  readonly active: boolean;
  readonly channel?: 'POS' | 'ONLINE' | 'BOTH';
}): boolean {
  const channel = method.channel ?? 'BOTH';
  return method.active && (channel === 'ONLINE' || channel === 'BOTH');
}

function isPublishedInstaPayMethod(method: {
  readonly displayName: string;
  readonly logicType: string;
  readonly integrationReference?: string | null;
}): boolean {
  if (method.logicType !== 'DIGITAL') return false;
  const integration = method.integrationReference?.trim().toUpperCase() ?? null;
  if (integration !== null) return integration === 'INSTAPAY';
  return method.displayName.replace(/\s+/g, '').toUpperCase() === 'INSTAPAY';
}

export function projectPublishedPublicOrdering(
  bundleJson: unknown,
  expectedShopId: string,
): PublishedPublicOrderingProjection {
  const { snapshot } = parseOperationsConfigurationBundle(bundleJson);
  if (snapshot.shopId !== expectedShopId) {
    throw new TypeError('published Operations configuration belongs to a different shop');
  }

  const settings = snapshot.settings;
  if (settings == null) {
    throw new TypeError('published settings are required for public catalog V2');
  }

  const identity = settings.shopIdentity;
  const fulfillmentPreferences: PublicFulfillmentPreferenceV2[] = [];
  if (
    snapshot.orderTypes.some((orderType) => orderType.active && orderType.behavior === 'TAKE_AWAY')
  ) {
    fulfillmentPreferences.push('PICKUP');
  }
  if (
    snapshot.orderTypes.some((orderType) => orderType.active && orderType.behavior === 'DELIVERY')
  ) {
    fulfillmentPreferences.push('DELIVERY');
  }

  const onlineMethods = snapshot.paymentMethods.filter(isOnlinePaymentMethod);
  const cashAvailable = onlineMethods.some((method) => method.logicType === 'CASH');
  const instaPayAvailable = onlineMethods.some(isPublishedInstaPayMethod);
  const paymentPreferences: PublicPaymentPreferenceV2[] = [];
  if (cashAvailable) paymentPreferences.push('CASH');
  if (instaPayAvailable) paymentPreferences.push('INSTAPAY');
  if (cashAvailable && instaPayAvailable) paymentPreferences.push('MIXED');

  return {
    shop: {
      displayName: identity.displayName,
      address: identity.address,
      phone: identity.phone,
      latitude: identity.latitude,
      longitude: identity.longitude,
    },
    ordering: {
      available:
        identity.lifecycleState === 'ACTIVE' &&
        !identity.temporaryClosed &&
        !identity.onlineOrdersPaused,
      temporaryClosed: identity.temporaryClosed,
      onlineOrdersPaused: identity.onlineOrdersPaused,
      minimumOrderMinor: nonNegativeIntegerSetting(
        settings.values,
        'checkout.minimumOrderMinor',
        Number.MAX_SAFE_INTEGER,
      ),
      serviceChargeBps: nonNegativeIntegerSetting(
        settings.values,
        'checkout.serviceChargeBps',
        10_000,
      ),
      taxBps: nonNegativeIntegerSetting(settings.values, 'checkout.taxBps', 10_000),
      fulfillmentPreferences,
      paymentPreferences,
    },
  };
}
