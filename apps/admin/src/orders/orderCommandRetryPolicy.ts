import { AdminApiError } from '../lib/adminApi';

/**
 * An unknown transport result or transient HTTP response does not prove the
 * financial command was rolled back. Reuse its durable command ID on retry.
 * Only a definitive client-side rejection can release that identity.
 */
export function shouldReleaseOrdersCommandIdAfterFailure(error: unknown): boolean {
  if (!(error instanceof AdminApiError)) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
