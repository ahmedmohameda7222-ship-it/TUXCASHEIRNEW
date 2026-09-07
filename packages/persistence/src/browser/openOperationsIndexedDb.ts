import { applyIndexedDbMigrations, INDEXED_DB_VERSION } from './indexedDbMigrations';

export function openOperationsIndexedDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, INDEXED_DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction;
      if (transaction === null) {
        reject(new Error('IndexedDB upgrade transaction is unavailable.'));
        return;
      }
      applyIndexedDbMigrations(
        request.result,
        transaction,
        event.oldVersion,
        event.newVersion ?? INDEXED_DB_VERSION,
      );
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB.')),
      { once: true },
    );
  });
}
