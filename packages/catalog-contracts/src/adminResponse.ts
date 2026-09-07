import { CatalogContractError, isCanonicalUuid, type CatalogAdminSuccessV1 } from './index';

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseCatalogAdminSuccessV1(value: unknown): CatalogAdminSuccessV1 {
  const root = object(value, 'response');
  const allowed = new Set(['schemaVersion', 'commandId', 'ok', 'result']);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) throw new CatalogContractError(`response has unexpected field ${key}`);
  }
  if (root.schemaVersion !== 1) throw new CatalogContractError('response.schemaVersion must be 1');
  if (root.ok !== true) throw new CatalogContractError('response.ok must be true');
  if (typeof root.commandId !== 'string' || !isCanonicalUuid(root.commandId)) {
    throw new CatalogContractError('response.commandId must be a valid UUID');
  }
  const result = object(root.result, 'response.result');
  return { schemaVersion: 1, commandId: root.commandId.toLowerCase(), ok: true, result };
}
