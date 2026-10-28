/** A 2xx HTTP response is not a business-command success when ok is false. */
export function requireSuccessfulCrmMutation<T extends { ok: boolean; code?: string }>(
  result: T,
): T {
  if (!result.ok) throw new Error(result.code || 'crm_action_rejected');
  return result;
}
