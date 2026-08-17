export type RemoteBackendMode = 'disabled' | 'supabase';

export interface RuntimeConfig {
  readonly remoteBackendMode: RemoteBackendMode;
}

export class RuntimeConfigError extends Error {
  override readonly name = 'RuntimeConfigError';
}

export function readRuntimeConfig(
  environment: Readonly<Record<string, string | boolean | undefined>>,
): RuntimeConfig {
  const rawMode = environment['VITE_TUX_REMOTE_BACKEND_MODE'];
  const mode = rawMode === undefined || rawMode === '' ? 'disabled' : rawMode;

  if (mode !== 'disabled' && mode !== 'supabase') {
    throw new RuntimeConfigError(
      `Unsupported VITE_TUX_REMOTE_BACKEND_MODE: ${String(mode)}. Expected disabled or supabase.`,
    );
  }

  return { remoteBackendMode: mode };
}
