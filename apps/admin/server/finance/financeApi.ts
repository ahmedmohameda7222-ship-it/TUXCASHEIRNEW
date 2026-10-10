import { z } from 'zod';

import {
  handleAdvancedFinance,
  isAdvancedFinanceCommand,
  isAdvancedFinanceView,
} from './financeOperationsApi.js';

import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../adminAuthService.js';
import {
  AdminAuthorizationError,
  requireBusinessWidePermission,
  requirePermission,
} from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import { adminRequestOperation } from '../observability.js';

const uuid = z.string().uuid();
const commandId = uuid;
const accountType = z.enum(['CASH', 'BANK', 'WALLET', 'PENDING_SETTLEMENT']);
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('finance.account.create'),
      shopId: uuid,
      scope: z.enum(['SHOP', 'BUSINESS']),
      name: z.string().trim().min(1).max(160),
      accountType,
      openingBalanceMinor: z.number().int().safe(),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.account.active'),
      shopId: uuid,
      accountId: uuid,
      expectedVersion: z.number().int().positive(),
      active: z.boolean(),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.mapping.set'),
      shopId: uuid,
      paymentMethodId: uuid,
      financeAccountId: uuid.nullable(),
      expectedVersion: z.number().int().nonnegative(),
      commandId,
    })
    .strict(),
]);

const movementLabels: Readonly<Record<string, string>> = {
  OPENING_FLOAT: 'Opening float',
  SALE: 'Sale',
  REFUND: 'Refund',
  PAY_IN: 'Cash paid in',
  PAY_OUT: 'Cash paid out',
  EXPENSE: 'Expense',
  BANK_DEPOSIT: 'Bank deposit',
  TRANSFER_IN: 'Transfer received',
  TRANSFER_OUT: 'Transfer sent',
  SETTLEMENT: 'Settlement',
  BANK_FEE: 'Bank fee',
  OWNER_CONTRIBUTION: 'Owner contribution',
  OWNER_WITHDRAWAL: 'Owner withdrawal',
  STAFF_PAYMENT: 'Staff payment',
  ADJUSTMENT: 'Adjustment',
};

type AccountRow = { id: string; business_id: string; shop_id: string | null };
type MovementRow = {
  id: string;
  movement_type: string;
  amount_minor: string | number;
  created_at: string;
};

function safeMinor(raw: string | number): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error('finance_amount_out_of_range');
  return parsed;
}

async function readAccountHistory(
  client: AdminSupabaseClient,
  businessId: string,
  shopId: string,
  role: string,
  accountId: string,
  movementId: string | null,
): Promise<Record<string, unknown>> {
  const accounts = await client.select<AccountRow[]>(
    'finance_accounts',
    new URLSearchParams({
      select: 'id,business_id,shop_id',
      id: `eq.${accountId}`,
      business_id: `eq.${businessId}`,
      limit: '1',
    }),
  );
  const account = accounts[0];
  if (!account || (account.shop_id !== null && account.shop_id !== shopId)) {
    throw new AdminAuthorizationError('shop_forbidden');
  }
  if (account.shop_id === null && role !== 'OWNER' && role !== 'ADMIN') {
    throw new AdminAuthorizationError('shop_forbidden');
  }

  const movementQuery = new URLSearchParams({
    select: 'id,movement_type,amount_minor,created_at',
    business_id: `eq.${businessId}`,
    finance_account_id: `eq.${accountId}`,
    order: 'created_at.desc,id.desc',
    limit: '50',
  });
  // Business accounts include movements from every shop in the tracked balance.
  // Owner/Admin may inspect that complete account history; shop accounts remain scoped.
  if (account.shop_id !== null) movementQuery.set('shop_id', `eq.${shopId}`);
  const latest = await client.select<MovementRow[]>('finance_movements', movementQuery);
  // A deep-linked immutable event may be older than the newest 50 movements.
  // Resolve it using the SAME account, business and shop scope, never by ID alone.
  let rows = latest;
  if (movementId && !latest.some((row) => row.id === movementId)) {
    const exactQuery = new URLSearchParams(movementQuery);
    exactQuery.set('id', `eq.${movementId}`);
    exactQuery.delete('order');
    exactQuery.set('limit', '1');
    const exact = await client.select<MovementRow[]>('finance_movements', exactQuery);
    rows = [...exact, ...latest];
  }
  return {
    accountId,
    movements: rows.map((movement) => ({
      id: movement.id,
      label: movementLabels[movement.movement_type] ?? 'Account activity',
      amountMinor: safeMinor(movement.amount_minor),
      occurredAt: movement.created_at,
    })),
  };
}

function sendFailure(response: AdminResponse, error: unknown, request: AdminRequest): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
  } else if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
  } else if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_finance_request' });
  } else if (error instanceof AdminSupabaseError) {
    console.error('Finance backend unavailable', { resource: 'finance', operation: adminRequestOperation(request), status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
  } else {
    console.error('Finance request failed', { resource: 'finance', operation: adminRequestOperation(request), status: 500 });
    sendJson(response, 500, { error: 'admin_request_failed' });
  }
}

export async function handleFinanceRequest(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const session = await loadAdminSession(token, client);
    const principal = session.principal;

    if (request.method === 'GET') {
      const query = new URL(request.url ?? '/', 'http://admin.local').searchParams;
      if (isAdvancedFinanceView(query.get('view'))) {
        await handleAdvancedFinance(request, response);
        return;
      }
      const shopId = uuid.parse(query.get('shopId'));
      requirePermission(principal, 'finance.view', shopId);
      if (query.get('view') === 'account-history') {
        const accountId = uuid.parse(query.get('accountId'));
        sendJson(
          response,
          200,
          await readAccountHistory(
            client,
            principal.businessId,
            shopId,
            principal.role,
            accountId,
            query.has('movementId') ? uuid.parse(query.get('movementId')) : null,
          ),
        );
        return;
      }
      const workspace = await client.rpc<Record<string, unknown>>('finance_workspace_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
      });
      if (workspace['ok'] !== true) {
        sendJson(response, 403, { error: 'permission_forbidden' });
        return;
      }
      sendJson(response, 200, workspace);
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const body = await readJsonObject(request);
    if (isAdvancedFinanceCommand(body['type'])) {
      await handleAdvancedFinance(request, response, body);
      return;
    }
    const command = commandSchema.parse(body);
    requireSessionCsrf(session, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    requirePermission(principal, 'finance.manage_accounts', command.shopId);

    let result: Record<string, unknown>;
    switch (command.type) {
      case 'finance.account.create': {
        if (command.scope === 'BUSINESS') {
          requireBusinessWidePermission(principal, 'finance.manage_accounts', command.shopId);
        }
        result = await client.rpc('create_finance_account_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: command.shopId,
          p_scope_shop_id: command.scope === 'SHOP' ? command.shopId : null,
          p_account_type: command.accountType,
          p_name: command.name,
          p_opening_balance_minor: command.openingBalanceMinor,
          p_command_id: command.commandId,
        });
        break;
      }
      case 'finance.account.active':
        result = await client.rpc('set_finance_account_active_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: command.shopId,
          p_account_id: command.accountId,
          p_expected_version: command.expectedVersion,
          p_active: command.active,
          p_command_id: command.commandId,
        });
        break;
      case 'finance.mapping.set':
        result = await client.rpc('set_payment_method_finance_account_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: command.shopId,
          p_payment_method_id: command.paymentMethodId,
          p_finance_account_id: command.financeAccountId,
          p_expected_version: command.expectedVersion,
          p_command_id: command.commandId,
        });
        break;
    }
    if (result['ok'] !== true) {
      const code = typeof result['code'] === 'string' ? result['code'] : 'finance_command_failed';
      sendJson(response, code.endsWith('_conflict') ? 409 : 400, { error: code });
      return;
    }
    sendJson(response, 200, result);
  } catch (error) {
    sendFailure(response, error, request);
  }
}
