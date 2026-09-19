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

function retainedKey(scope: string, intent: unknown): string {
  return `${scope}\u0000${stableFingerprint(intent)}`;
}

export function createRetainedCommandIds(createId: () => string = () => crypto.randomUUID()) {
  const retained = new Map<string, string>();

  return {
    forIntent(scope: string, intent: unknown): string {
      const key = retainedKey(scope, intent);
      const existing = retained.get(key);
      if (existing !== undefined) return existing;
      const commandId = createId();
      retained.set(key, commandId);
      return commandId;
    },
    complete(scope: string, intent: unknown): void {
      retained.delete(retainedKey(scope, intent));
    },
  };
}
