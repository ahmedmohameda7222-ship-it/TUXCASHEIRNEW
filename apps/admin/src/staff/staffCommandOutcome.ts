import type { StaffCommandResult } from '@tux/admin-contracts';

/**
 * HTTP 2xx does not imply a successful staff mutation.
 * Pending second-person approval is a valid non-applied server receipt.
 */
export function assertStaffCommandOutcome<T extends StaffCommandResult>(
  result: T,
): Extract<T, { readonly ok: true }> {
  if (!result.ok) throw new Error(result.code);
  return result as Extract<T, { readonly ok: true }>;
}
