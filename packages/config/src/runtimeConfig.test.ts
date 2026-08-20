import { describe, expect, it } from 'vitest';
import { readRuntimeConfig, RuntimeConfigError } from './runtimeConfig';

describe('readRuntimeConfig', () => {
  it('defaults to a disabled remote backend', () => {
    expect(readRuntimeConfig({})).toEqual({ remoteBackendMode: 'disabled' });
  });

  it('rejects unknown remote backend modes', () => {
    expect(() => readRuntimeConfig({ VITE_TUX_REMOTE_BACKEND_MODE: 'legacy' })).toThrow(
      RuntimeConfigError,
    );
  });
});
