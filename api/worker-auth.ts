import {
  proxyWorkerAuthentication,
  type GatewayRequest,
  type GatewayResponse,
} from '../server/workerAuthenticationGateway';

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await proxyWorkerAuthentication(request, response);
}
