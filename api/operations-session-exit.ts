import type { IncomingMessage, ServerResponse } from 'node:http';
import { proxyAuthenticatedFunction } from '../server/supabaseGateway.js';

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await proxyAuthenticatedFunction(request, response, 'operations-session-exit');
}
