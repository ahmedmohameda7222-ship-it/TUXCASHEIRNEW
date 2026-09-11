import type {
  AdminSessionPrincipal,
  CatalogRecurringAvailabilityProduct,
  CatalogRecurringAvailabilityRuleSummary,
  CatalogRecurringAvailabilityWorkspace,
  CatalogSaveRecurringAvailabilityRuleInput,
  CatalogSaveRecurringAvailabilityRuleResult,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import type { AdminSupabaseClient } from '../supabaseAdmin';

export class RecurringAvailabilityServiceError extends Error {
  constructor(readonly code: 'backend_contract_invalid') {
    super(code);
    this.name = 'RecurringAvailabilityServiceError';
  }
}

export interface RecurringAvailabilityStore {
  loadWorkspace(shopId: string, businessId: string): Promise<CatalogRecurringAvailabilityWorkspace>;
  saveRule(input: {
    employeeId: string;
    shopId: string;
    ruleId: string | null;
    masterProductId: string;
    daysOfWeek: number[];
    startLocal: string;
    endLocal: string;
    available: boolean;
    active: boolean;
    expectedVersion: number | null;
  }): Promise<CatalogSaveRecurringAvailabilityRuleResult>;
}

type ProductOverrideRow = {
  master_product_id: string;
  canonical_product_id: string;
  manual_sold_out: boolean;
};

type MasterProductRow = {
  id: string;
  canonical_name: string;
};

type RecurringRuleRow = {
  id: string;
  shop_id: string;
  master_product_id: string;
  timezone: string;
  days_of_week: unknown;
  start_local: string;
  end_local: string;
  available: boolean;
  active: boolean;
  version: number | string;
  updated_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInteger(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  }
  return numeric;
}

function readDays(value: unknown): number[] {
  if (!Array.isArray(value))
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  const days = value.map(readInteger);
  if (days.length < 1 || days.length > 7 || days.some((day) => day > 6)) {
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  }
  return days;
}

function readNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  }
  return value;
}

function mapRule(row: RecurringRuleRow): CatalogRecurringAvailabilityRuleSummary {
  if (row.timezone !== 'Africa/Cairo') {
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  }
  return {
    id: row.id,
    shopId: row.shop_id,
    masterProductId: row.master_product_id,
    timezone: 'Africa/Cairo',
    daysOfWeek: readDays(row.days_of_week),
    startLocal: readNonemptyString(row.start_local),
    endLocal: readNonemptyString(row.end_local),
    available: row.available,
    active: row.active,
    version: readInteger(row.version),
    updatedAt: readNonemptyString(row.updated_at),
  };
}

function requireRpcResult(value: unknown): CatalogSaveRecurringAvailabilityRuleResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new RecurringAvailabilityServiceError('backend_contract_invalid');
  }
  return value as CatalogSaveRecurringAvailabilityRuleResult;
}

export function createRecurringAvailabilityService(store: RecurringAvailabilityStore) {
  return {
    async loadRecurringAvailability(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogRecurringAvailabilityWorkspace> {
      requirePermission(principal, 'catalog.view', shopId);
      return store.loadWorkspace(shopId, principal.businessId);
    },

    async saveRecurringAvailabilityRule(
      input: CatalogSaveRecurringAvailabilityRuleInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogSaveRecurringAvailabilityRuleResult> {
      requirePermission(principal, 'catalog.edit', input.shopId);
      return store.saveRule({
        employeeId: principal.employeeId,
        shopId: input.shopId,
        ruleId: input.ruleId,
        masterProductId: input.masterProductId,
        daysOfWeek: [...input.daysOfWeek],
        startLocal: input.startLocal,
        endLocal: input.endLocal,
        available: input.available,
        active: input.active,
        expectedVersion: input.expectedVersion,
      });
    },
  };
}

export function createSupabaseRecurringAvailabilityStore(
  client: AdminSupabaseClient,
): RecurringAvailabilityStore {
  return {
    async loadWorkspace(shopId, businessId) {
      const [overrides, masterProducts, rules] = await Promise.all([
        client.select<ProductOverrideRow[]>(
          'catalog_product_shop_overrides',
          new URLSearchParams({
            select: 'master_product_id,canonical_product_id,manual_sold_out',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'canonical_product_id.asc',
          }),
        ),
        client.select<MasterProductRow[]>(
          'catalog_master_products',
          new URLSearchParams({
            select: 'id,canonical_name',
            business_id: `eq.${businessId}`,
            order: 'canonical_name.asc,id.asc',
          }),
        ),
        client.select<RecurringRuleRow[]>(
          'recurring_availability_rules',
          new URLSearchParams({
            select:
              'id,shop_id,master_product_id,timezone,days_of_week,start_local,end_local,available,active,version,updated_at',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'updated_at.desc,id.asc',
          }),
        ),
      ]);

      const masterNameById = new Map(
        masterProducts.map((product) => [product.id, product.canonical_name] as const),
      );
      const products: CatalogRecurringAvailabilityProduct[] = overrides.map((override) => {
        const name = masterNameById.get(override.master_product_id);
        if (!name) throw new RecurringAvailabilityServiceError('backend_contract_invalid');
        return {
          masterProductId: override.master_product_id,
          productId: override.canonical_product_id,
          name,
          manualSoldOut: override.manual_sold_out,
        };
      });

      products.sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.productId.localeCompare(right.productId),
      );

      return {
        shopId,
        products,
        rules: rules.map(mapRule),
      };
    },

    async saveRule(input) {
      const result = await client.rpc<unknown>('save_recurring_availability_rule_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_rule_id: input.ruleId,
        p_master_product_id: input.masterProductId,
        p_days_of_week: input.daysOfWeek,
        p_start_local: input.startLocal,
        p_end_local: input.endLocal,
        p_available: input.available,
        p_active: input.active,
        p_expected_version: input.expectedVersion,
      });
      return requireRpcResult(result);
    },
  };
}
