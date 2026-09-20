function stableFingerprint(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableFingerprint(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableFingerprint(object[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function retainedKey(namespace: string, scope: string, intent: unknown): string {
  return `${namespace}\u0000${scope}\u0000${stableFingerprint(intent)}`;
}

function storageKey(key: string): string {
  return `tux.admin.pending-command.v1:${encodeURIComponent(key)}`;
}

function durableStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function storedCommandId(storage: Storage | null, key: string): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(storageKey(key));
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistCommandId(storage: Storage | null, key: string, commandId: string): void {
  if (storage === null) return;
  try {
    storage.setItem(storageKey(key), commandId);
  } catch {
    // Storage can be unavailable or quota-restricted. In-memory retention still protects this mount.
  }
}

function clearCommandId(storage: Storage | null, key: string): void {
  if (storage === null) return;
  try {
    storage.removeItem(storageKey(key));
  } catch {
    // An authoritative response has already been received; storage cleanup is best-effort.
  }
}

export function createRetainedCommandIds(
  namespace: string,
  createId: () => string = () => crypto.randomUUID(),
) {
  if (namespace.trim().length === 0) throw new Error('retained_command_namespace_required');
  const retained = new Map<string, string>();
  const storage = durableStorage();

  return {
    forIntent(scope: string, intent: unknown): string {
      const key = retainedKey(namespace, scope, intent);
      const existing = retained.get(key) ?? storedCommandId(storage, key);
      if (existing !== null && existing !== undefined) {
        retained.set(key, existing);
        return existing;
      }
      const commandId = createId();
      retained.set(key, commandId);
      persistCommandId(storage, key, commandId);
      return commandId;
    },
    complete(scope: string, intent: unknown): void {
      const key = retainedKey(namespace, scope, intent);
      retained.delete(key);
      clearCommandId(storage, key);
    },
  };
}
