import { createHash } from 'node:crypto';

import type {
  AdminAlert,
  AdminAlertsPage,
  AdminInventoryIntelligence,
  AdminInventoryItem,
  AdminSessionPrincipal,
  AlertSeverity,
  AlertSource,
} from '@tux/admin-contracts';

import {
  listApprovalReadPage,
  type ApprovalReadModel,
  type ApprovalReadPage,
} from '../approvals/approvalReadService.js';
import { requirePermission } from '../authorization.js';
import { loadInventoryIntelligence } from '../inventory/intelligenceService.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export type AlertsReadInput = {
  shopId: string;
  source?: AlertSource;
  severity?: AlertSeverity;
  state?: 'ACTIVE' | 'RESOLVED';
  cursor?: string;
  limit: number;
};

export type AlertsSourceDependencies = {
  loadShopName(principal: AdminSessionPrincipal, shopId: string): Promise<string>;
  loadApprovals(principal: AdminSessionPrincipal, shopId: string): Promise<ApprovalReadPage>;
  loadInventory(
    principal: AdminSessionPrincipal,
    shopId: string,
  ): Promise<AdminInventoryIntelligence>;
  now(): Date;
};

export type AlertsCursor = {
  businessId: string;
  shopId: string;
  source: AlertSource | null;
  severity: AlertSeverity | null;
  state: 'ACTIVE' | 'RESOLVED' | null;
  observedAt: string;
  id: string;
};

const ALERT_SOURCES: readonly AlertSource[] = [
  'APPROVAL',
  'INVENTORY',
  'DELIVERY',
  'OPERATIONS',
  'WHATSAPP',
];
const ALERT_SEVERITIES: readonly AlertSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];
const DATA_PAGE_SIZE = 10_000;

function stableAlertId(parts: readonly (string | null)[]): string {
  return `alert_${createHash('sha256')
    .update(parts.map((part) => part ?? '-').join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function encodeAlertsCursor(cursor: AlertsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeAlertsCursor(cursor: string): AlertsCursor | null {
  if (cursor.length === 0 || cursor.length > 2_048) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      typeof value['businessId'] !== 'string' ||
      typeof value['shopId'] !== 'string' ||
      !(value['source'] === null || ALERT_SOURCES.includes(value['source'] as AlertSource)) ||
      !(
        value['severity'] === null || ALERT_SEVERITIES.includes(value['severity'] as AlertSeverity)
      ) ||
      !(value['state'] === null || value['state'] === 'ACTIVE' || value['state'] === 'RESOLVED') ||
      typeof value['observedAt'] !== 'string' ||
      Number.isNaN(Date.parse(value['observedAt'])) ||
      typeof value['id'] !== 'string'
    ) {
      return null;
    }
    return value as AlertsCursor;
  } catch {
    return null;
  }
}

function approvalAlert(
  approval: ApprovalReadModel,
  principal: AdminSessionPrincipal,
  shopId: string,
  shopName: string,
): AdminAlert | null {
  if (approval.shopId !== shopId) return null;
  if (approval.status !== 'PENDING' && approval.status !== 'FAILED') return null;
  if (approval.status === 'FAILED' && !approval.recoveryMessage) return null;
  const severity: AlertSeverity = approval.status === 'FAILED' ? 'CRITICAL' : 'WARNING';
  const signal = approval.status === 'FAILED' ? 'failed-recoverable' : 'pending-action';
  return {
    id: stableAlertId(['APPROVAL', principal.businessId, shopId, approval.id, signal]),
    businessId: principal.businessId,
    shopId,
    shopName,
    source: 'APPROVAL',
    severity,
    title:
      approval.status === 'FAILED'
        ? `${approval.actionLabel} needs recovery`
        : `${approval.actionLabel} needs review`,
    description:
      approval.status === 'FAILED'
        ? (approval.recoveryMessage ?? 'Review this failed approval safely.')
        : approval.consequence,
    observedAt: approval.failedAt ?? approval.createdAt,
    entityId: approval.id,
    href: '/approvals',
    state: 'ACTIVE',
  };
}

function inventoryAlerts(
  intelligence: AdminInventoryIntelligence,
  principal: AdminSessionPrincipal,
  shopId: string,
  shopName: string,
  observedAt: string,
): AdminAlert[] {
  return intelligence.reorderSuggestions
    .filter(
      (suggestion) =>
        suggestion.reorderPointMicros > 0 &&
        suggestion.availableMicros <= suggestion.reorderPointMicros,
    )
    .map((suggestion) => ({
      id: stableAlertId([
        'INVENTORY',
        principal.businessId,
        shopId,
        suggestion.inventoryItemId,
        'reorder',
      ]),
      businessId: principal.businessId,
      shopId,
      shopName,
      source: 'INVENTORY' as const,
      severity: suggestion.availableMicros <= 0 ? ('CRITICAL' as const) : ('WARNING' as const),
      title:
        suggestion.availableMicros <= 0
          ? `${suggestion.itemName} is out of stock`
          : `${suggestion.itemName} is below its reorder point`,
      description: `Available ${suggestion.availableMicros} ${suggestion.unitLabel}; suggested order ${suggestion.suggestedOrderMicros} ${suggestion.unitLabel}.`,
      observedAt,
      entityId: suggestion.inventoryItemId,
      href: '/inventory',
      state: 'ACTIVE' as const,
    }));
}

function matchesCursorScope(
  cursor: AlertsCursor,
  input: AlertsReadInput,
  principal: AdminSessionPrincipal,
): boolean {
  return (
    cursor.businessId === principal.businessId &&
    cursor.shopId === input.shopId &&
    cursor.source === (input.source ?? null) &&
    cursor.severity === (input.severity ?? null) &&
    cursor.state === (input.state ?? null)
  );
}

function isAfterCursor(alert: AdminAlert, cursor: AlertsCursor): boolean {
  return (
    alert.observedAt < cursor.observedAt ||
    (alert.observedAt === cursor.observedAt && alert.id < cursor.id)
  );
}

export function createAlertsService(deps: AlertsSourceDependencies) {
  return {
    async list(input: AlertsReadInput, principal: AdminSessionPrincipal): Promise<AdminAlertsPage> {
      requirePermission(principal, 'alerts.view', input.shopId);
      const cursor = input.cursor ? decodeAlertsCursor(input.cursor) : null;
      if (input.cursor && (!cursor || !matchesCursorScope(cursor, input, principal))) {
        throw new Error('invalid_alerts_cursor');
      }

      const asOf = deps.now().toISOString();
      const shopName = await deps.loadShopName(principal, input.shopId);
      const alerts: AdminAlert[] = [];
      const unavailableSources: AlertSource[] = [];

      if (
        (!input.source || input.source === 'APPROVAL') &&
        principal.permissions.includes('approvals.review')
      ) {
        try {
          const page = await deps.loadApprovals(principal, input.shopId);
          for (const approval of page.approvals) {
            const alert = approvalAlert(approval, principal, input.shopId, shopName);
            if (alert) alerts.push(alert);
          }
        } catch {
          unavailableSources.push('APPROVAL');
        }
      }

      if (
        (!input.source || input.source === 'INVENTORY') &&
        principal.permissions.includes('inventory.view')
      ) {
        try {
          alerts.push(
            ...inventoryAlerts(
              await deps.loadInventory(principal, input.shopId),
              principal,
              input.shopId,
              shopName,
              asOf,
            ),
          );
        } catch {
          unavailableSources.push('INVENTORY');
        }
      }

      const deduplicated = [...new Map(alerts.map((alert) => [alert.id, alert])).values()]
        .filter((alert) => !input.source || alert.source === input.source)
        .filter((alert) => !input.severity || alert.severity === input.severity)
        .filter((alert) => !input.state || alert.state === input.state)
        .sort(
          (left, right) =>
            right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id),
        );
      const continued = cursor
        ? deduplicated.filter((alert) => isAfterCursor(alert, cursor))
        : deduplicated;
      const rows = continued.slice(0, input.limit);
      const last = rows.at(-1);
      const nextCursor =
        continued.length > input.limit && last
          ? encodeAlertsCursor({
              businessId: principal.businessId,
              shopId: input.shopId,
              source: input.source ?? null,
              severity: input.severity ?? null,
              state: input.state ?? null,
              observedAt: last.observedAt,
              id: last.id,
            })
          : null;
      return { rows, nextCursor, asOf, scopeLabel: shopName, unavailableSources };
    },
  };
}

type InventoryItemRow = {
  id: string;
  name: string;
  unit_label: string;
  tracking_mode: string;
  active: boolean;
  definition_version: number | string;
  low_stock_threshold_micros: number | string | null;
};
type BalanceRow = {
  inventory_item_id: string;
  on_hand_micros: number | string;
  reserved_micros: number | string;
  available_micros: number | string;
};
type CostRow = { inventory_item_id: string; weighted_unit_cost_minor: number | string };

function safeInteger(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('alerts_inventory_contract_invalid');
  return parsed;
}

async function loadPaged<T>(load: (offset: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await load(rows.length);
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

export function createSupabaseAlertsDependencies(
  client: AdminSupabaseClient,
): AlertsSourceDependencies {
  return {
    async loadShopName(principal, shopId) {
      const rows = await client.select<{ id: string; name: string }[]>(
        'shops',
        new URLSearchParams({
          select: 'id,name',
          id: `eq.${shopId}`,
          business_id: `eq.${principal.businessId}`,
          limit: '1',
        }),
      );
      if (rows.length !== 1) throw new Error('shop_not_found');
      return rows[0]!.name;
    },
    async loadApprovals(principal, shopId) {
      const [pending, failed] = await Promise.all([
        listApprovalReadPage(client, principal, { shopId, status: 'PENDING' }),
        listApprovalReadPage(client, principal, { shopId, status: 'FAILED' }),
      ]);
      return { approvals: [...pending.approvals, ...failed.approvals], nextCursor: null };
    },
    async loadInventory(principal, shopId) {
      const [itemRows, balanceRows, costRows] = await Promise.all([
        loadPaged((offset) =>
          client.select<InventoryItemRow[]>(
            'inventory_items',
            new URLSearchParams({
              select:
                'id,name,unit_label,tracking_mode,active,definition_version,low_stock_threshold_micros',
              shop_id: `eq.${shopId}`,
              order: 'name.asc,id.asc',
              limit: String(DATA_PAGE_SIZE),
              offset: String(offset),
            }),
          ),
        ),
        loadPaged((offset) =>
          client.rpc<BalanceRow[]>(
            'read_admin_inventory_balances_v1',
            { p_employee_id: principal.employeeId, p_shop_id: shopId },
            new URLSearchParams({
              order: 'inventory_item_id.asc',
              limit: String(DATA_PAGE_SIZE),
              offset: String(offset),
            }),
          ),
        ),
        loadPaged((offset) =>
          client.select<CostRow[]>(
            'inventory_cost_state',
            new URLSearchParams({
              select: 'inventory_item_id,weighted_unit_cost_minor',
              shop_id: `eq.${shopId}`,
              order: 'inventory_item_id.asc',
              limit: String(DATA_PAGE_SIZE),
              offset: String(offset),
            }),
          ),
        ),
      ]);
      const balances = new Map(balanceRows.map((row) => [row.inventory_item_id, row]));
      const costs = new Map(costRows.map((row) => [row.inventory_item_id, row]));
      const items: AdminInventoryItem[] = itemRows.flatMap((row) => {
        const balance = balances.get(row.id);
        if (!balance) return [];
        const cost = costs.get(row.id);
        return [
          {
            id: row.id,
            name: row.name,
            unitLabel: row.unit_label,
            trackingMode: row.tracking_mode,
            active: row.active,
            definitionVersion: safeInteger(row.definition_version),
            lowStockThresholdMicros:
              row.low_stock_threshold_micros === null
                ? null
                : safeInteger(row.low_stock_threshold_micros),
            conversions: [],
            onHandMicros: safeInteger(balance.on_hand_micros),
            reservedMicros: safeInteger(balance.reserved_micros),
            availableMicros: safeInteger(balance.available_micros),
            weightedUnitCostMinor: cost ? safeInteger(cost.weighted_unit_cost_minor) : 0,
            history: [],
          },
        ];
      });
      return loadInventoryIntelligence(client, shopId, items);
    },
    now: () => new Date(),
  };
}
