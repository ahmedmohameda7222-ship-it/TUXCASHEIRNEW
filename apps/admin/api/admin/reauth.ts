import {
  handleAdminReauth,
  type AdminRequest,
  type AdminResponse,
} from '../../server/adminAuthGateway';

export default async function handler(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  await handleAdminReauth(request, response);
}
