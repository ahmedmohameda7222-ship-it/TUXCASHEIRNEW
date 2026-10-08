import { handleReportsRequest } from '../../server/reports/reportApi.js';
import type { AdminRequest, AdminResponse } from '../../server/http.js';

export default async function handler(request: AdminRequest, response: AdminResponse): Promise<void> {
  await handleReportsRequest(request, response);
}
