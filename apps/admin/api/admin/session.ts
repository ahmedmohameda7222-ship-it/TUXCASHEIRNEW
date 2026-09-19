import {
  handleAdminSession,
  type AdminRequest,
  type AdminResponse,
} from '../../server/adminAuthGateway.js';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  await handleAdminSession(request, response);
}
