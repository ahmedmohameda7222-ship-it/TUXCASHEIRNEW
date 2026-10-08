import { handleFinanceRequest } from '../../server/finance/financeApi.js';
import type { AdminRequest, AdminResponse } from '../../server/http.js';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  await handleFinanceRequest(request, response);
}
