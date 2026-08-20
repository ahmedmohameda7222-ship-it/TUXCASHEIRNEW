import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parseEntityId, type ShopId } from '@tux/domain';
import type { SupabaseDeviceSessionRecord, SupabaseDeviceSessionStore } from '@tux/sync';
import { safeStorage } from 'electron';

function parseRecord(value: unknown): SupabaseDeviceSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Stored TUX device session must be an object.');
  }
  const source = value as Record<string, unknown>;
  const text = (key: string): string => {
    const candidate = source[key];
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      throw new TypeError(`Stored TUX device session ${key} is invalid.`);
    }
    return candidate.trim();
  };
  const expiresAt = source['expiresAt'];
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError('Stored TUX device session expiresAt is invalid.');
  }
  return {
    shopId: parseEntityId<ShopId>(text('shopId')),
    deviceId: text('deviceId'),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    expiresAt,
  };
}

export class ElectronSafeStorageDeviceSessionStore implements SupabaseDeviceSessionStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<SupabaseDeviceSessionRecord | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.#filePath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS credential encryption is unavailable; refusing to load TUX device secrets.',
      );
    }
    return parseRecord(JSON.parse(safeStorage.decryptString(encrypted)) as unknown);
  }

  async save(session: SupabaseDeviceSessionRecord): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS credential encryption is unavailable; refusing to store TUX device secrets.',
      );
    }
    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    await writeFile(temporaryPath, encrypted, { mode: 0o600 });
    await rename(temporaryPath, this.#filePath);
  }
}
