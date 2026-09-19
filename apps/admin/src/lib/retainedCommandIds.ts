type RetainedCommand = {
  readonly fingerprint: string;
  readonly commandId: string;
};

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

export function createRetainedCommandIds(
  createId: () => string = () => crypto.randomUUID(),
) {
  const retained = new Map<string, RetainedCommand>();

  return {
    forIntent(scope: string, intent: unknown): string {
      const fingerprint = stableFingerprint(intent);
      const existing = retained.get(scope);
      if (existing?.fingerprint === fingerprint) return existing.commandId;
      const commandId = createId();
      retained.set(scope, { fingerprint, commandId });
      return commandId;
    },
    complete(scope: string, intent: unknown): void {
      const fingerprint = stableFingerprint(intent);
      if (retained.get(scope)?.fingerprint === fingerprint) retained.delete(scope);
    },
  };
}
