import {
  handleCrmRequest,
} from '../../server/customers/crmApi.js';
import {
  handleCustomersRequest,
} from '../../server/customers/customerApi.js';
import type {
  AdminRequest,
  AdminResponse,
} from '../../server/http.js';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://admin.local');
  if (
    url.searchParams.has('view') ||
    url.searchParams.get('surface') === 'crm'
  ) {
    await handleCrmRequest(request, response);
    return;
  }
  await handleCustomersRequest(request, response);
}
