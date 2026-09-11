import type {
  AdminPaymentMethodConfiguration,
  AdminSessionPrincipal,
  ResolvedSetting,
  SettingsChannelContext,
  ShopDeleteOrArchiveResult,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';

export type SettingLayers<T = unknown> = {
  businessDefault: T | null;
  shopOverride: T | null;
};

export interface SettingsStore {
  getSettingLayers<T = unknown>(input: {
    businessId: string;
    shopId: string;
    key: string;
  }): Promise<SettingLayers<T>>;
  shopHasBusinessHistory(input: { businessId: string; shopId: string }): Promise<boolean>;
  archiveShop(input: {
    businessId: string;
    shopId: string;
    employeeId: string;
  }): Promise<ShopDeleteOrArchiveResult>;
  deleteUnusedShop(input: {
    businessId: string;
    shopId: string;
    employeeId: string;
  }): Promise<ShopDeleteOrArchiveResult>;
}

export function resolveAllowedPaymentMethods<T extends AdminPaymentMethodConfiguration>(
  methods: readonly T[],
  context: SettingsChannelContext,
): T[] {
  return methods.filter(
    (method) =>
      method.active && (method.channel === 'BOTH' || method.channel === context.channel),
  );
}

export function createSettingsService(store: SettingsStore) {
  return {
    async resolveSetting<T = unknown>(
      key: string,
      context: { businessId: string; shopId: string },
    ): Promise<ResolvedSetting<T>> {
      const layers = await store.getSettingLayers<T>({ ...context, key });
      if (layers.shopOverride !== null) {
        return { source: 'shop', value: layers.shopOverride };
      }
      if (layers.businessDefault !== null) {
        return { source: 'business', value: layers.businessDefault };
      }
      return { source: 'unset', value: null };
    },

    async deleteOrArchiveShop(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<ShopDeleteOrArchiveResult> {
      requirePermission(principal, 'shops.manage', shopId);
      const input = {
        businessId: principal.businessId,
        shopId,
        employeeId: principal.employeeId,
      };
      if (await store.shopHasBusinessHistory({ businessId: input.businessId, shopId })) {
        return store.archiveShop(input);
      }
      return store.deleteUnusedShop(input);
    },
  };
}
