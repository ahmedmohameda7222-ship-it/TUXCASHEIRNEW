import {
  handleApprovalExecutionRequest,
  runProductionApprovalExecutionRunner,
} from '../../server/approvals/approvalExecutionRunner';
import { firstHeader, sendJson, type AdminRequest, type AdminResponse } from '../../server/http';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  const result = await handleApprovalExecutionRequest({
    method: request.method,
    authorization: firstHeader(request.headers.authorization),
    cronSecret: process.env['CRON_SECRET'],
    run: runProductionApprovalExecutionRunner,
  });

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  sendJson(response, result.statusCode, result.body);
}
