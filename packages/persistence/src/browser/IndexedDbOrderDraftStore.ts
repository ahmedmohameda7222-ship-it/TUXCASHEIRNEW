import {
  assertParkedOrderDraftInvariant,
  parseOrderDraft,
  type BusinessDayId,
  type OrderDraft,
  type ParkedOrderDraft,
  type ShopId,
} from '@tux/domain';
import type {
  OrderDraftKey,
  OrderDraftStore,
  ParkAndReplaceOrderDraftInput,
  ResolveParkedOrderDraftInput,
  RestoreParkedOrderDraftInput,
} from '../orderDraftStore';

const DATABASE_VERSION = 2;
const STORE_NAME = 'drafts';
const PARKED_STORE_NAME = 'parkedDrafts';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB draft request failed.')),
      { once: true },
    );
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB draft transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB draft transaction failed.')),
      { once: true },
    );
  });
}
function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const store = request.result.createObjectStore(STORE_NAME, {
          keyPath: ['shopId', 'businessDayId', 'draftScopeId'],
        });
        store.createIndex('checkoutIntent', ['shopId', 'checkoutIntentKey']);
      }
      if (oldVersion < 2) {
        const parked = request.result.createObjectStore(PARKED_STORE_NAME, { keyPath: 'id' });
        parked.createIndex('authorityStateParkedAt', [
          'shopId',
          'businessDayId',
          'state',
          'parkedAt',
        ]);
        parked.createIndex('authorityScope', ['shopId', 'businessDayId', 'draftScopeId']);
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB draft database.')),
      { once: true },
    );
  });
}
function keyTuple(key: OrderDraftKey): [string, string, string] {
  return [key.shopId, key.businessDayId, key.draftScopeId];
}
function sameAuthority(
  value: Pick<OrderDraft, 'shopId' | 'businessDayId' | 'draftScopeId'>,
  key: OrderDraftKey,
): boolean {
  return (
    value.shopId === key.shopId &&
    value.businessDayId === key.businessDayId &&
    value.draftScopeId === key.draftScopeId
  );
}
function parseParked(value: unknown): ParkedOrderDraft {
  if (typeof value !== 'object' || value === null)
    throw new Error('Parked order draft record is invalid.');
  const raw = value as ParkedOrderDraft;
  const parsed: ParkedOrderDraft = { ...raw, draft: parseOrderDraft(raw.draft) };
  assertParkedOrderDraftInvariant(parsed);
  return parsed;
}
function assertParkSnapshot(
  record: ParkedOrderDraft,
  active: OrderDraft,
  key: OrderDraftKey,
): void {
  assertParkedOrderDraftInvariant(record);
  if (!sameAuthority(record, key) || JSON.stringify(record.draft) !== JSON.stringify(active))
    throw new Error(
      'Parked order draft must snapshot the current active draft authority and payload.',
    );
}
function assertReplacement(draft: OrderDraft, key: OrderDraftKey): OrderDraft {
  const parsed = parseOrderDraft(draft);
  if (!sameAuthority(parsed, key))
    throw new Error('Replacement order draft authority must match the active key.');
  return parsed;
}

export class IndexedDbOrderDraftStore implements OrderDraftStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;
  constructor(name = 'tux-operations-v2-drafts') {
    this.#name = name;
  }
  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openDatabase(this.#name);
    if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined)
      await navigator.storage.persist();
  }
  async get(key: OrderDraftKey): Promise<OrderDraft | null> {
    const db = this.#requireDatabase();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const result = await requestResult(tx.objectStore(STORE_NAME).get(keyTuple(key)));
    await transactionDone(tx);
    return result === undefined ? null : parseOrderDraft(result);
  }
  async put(draft: OrderDraft): Promise<void> {
    const validated = parseOrderDraft(draft);
    const db = this.#requireDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(tx);
    const store = tx.objectStore(STORE_NAME);
    try {
      const key: OrderDraftKey = {
        shopId: validated.shopId,
        businessDayId: validated.businessDayId,
        draftScopeId: validated.draftScopeId,
      };
      const existing = await requestResult(store.get(keyTuple(key)));
      if (
        existing !== undefined &&
        typeof existing === 'object' &&
        existing !== null &&
        'revision' in existing &&
        Number((existing as { revision: unknown }).revision) > validated.revision
      )
        throw new Error('Refusing to overwrite a newer durable order draft revision.');
      await requestResult(store.put(validated));
      await completion;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async delete(key: OrderDraftKey): Promise<void> {
    const db = this.#requireDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(tx);
    try {
      await requestResult(tx.objectStore(STORE_NAME).delete(keyTuple(key)));
      await completion;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async listParked(
    shopId: ShopId,
    businessDayId: BusinessDayId,
  ): Promise<readonly ParkedOrderDraft[]> {
    const db = this.#requireDatabase();
    const tx = db.transaction(PARKED_STORE_NAME, 'readonly');
    const rows = await requestResult(tx.objectStore(PARKED_STORE_NAME).getAll());
    await transactionDone(tx);
    return rows
      .map(parseParked)
      .filter(
        (x) => x.shopId === shopId && x.businessDayId === businessDayId && x.state === 'PARKED',
      )
      .sort((a, b) => a.parkedAt.localeCompare(b.parkedAt) || a.id.localeCompare(b.id));
  }
  async parkAndReplace(input: ParkAndReplaceOrderDraftInput): Promise<ParkedOrderDraft> {
    const db = this.#requireDatabase();
    const replacement = assertReplacement(input.replacement, input.activeKey);
    const tx = db.transaction([STORE_NAME, PARKED_STORE_NAME], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(tx);
    const drafts = tx.objectStore(STORE_NAME);
    const parkedStore = tx.objectStore(PARKED_STORE_NAME);
    try {
      const raw = await requestResult(drafts.get(keyTuple(input.activeKey)));
      if (raw === undefined) throw new Error('Active order draft was not found.');
      const active = parseOrderDraft(raw);
      if (active.revision !== input.expectedActiveRevision)
        throw new Error('Active order draft revision changed.');
      assertParkSnapshot(input.parked, active, input.activeKey);
      if ((await requestResult(parkedStore.get(input.parked.id))) !== undefined)
        throw new Error('Parked order draft id already exists.');
      await requestResult(parkedStore.add(input.parked));
      await requestResult(drafts.put(replacement));
      await completion;
      return input.parked;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async restoreParked(input: RestoreParkedOrderDraftInput): Promise<{
    readonly restoredDraft: OrderDraft;
    readonly parkedActive: ParkedOrderDraft | null;
  }> {
    const db = this.#requireDatabase();
    const tx = db.transaction([STORE_NAME, PARKED_STORE_NAME], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(tx);
    const drafts = tx.objectStore(STORE_NAME);
    const parkedStore = tx.objectStore(PARKED_STORE_NAME);
    try {
      const selectedRaw = await requestResult(parkedStore.get(input.parkedId));
      if (selectedRaw === undefined) throw new Error('Parked order draft was not found.');
      const selected = parseParked(selectedRaw);
      if (
        selected.shopId !== input.activeKey.shopId ||
        selected.businessDayId !== input.activeKey.businessDayId ||
        selected.draftScopeId !== input.activeKey.draftScopeId ||
        selected.state !== 'PARKED'
      )
        throw new Error('Parked order draft does not belong to the active authority.');
      const activeRaw = await requestResult(drafts.get(keyTuple(input.activeKey)));
      if (activeRaw === undefined) throw new Error('Active order draft was not found.');
      const active = parseOrderDraft(activeRaw);
      if (active.revision !== input.expectedActiveRevision)
        throw new Error('Active order draft revision changed.');
      let parkedActive: ParkedOrderDraft | null = null;
      if (input.parkActiveAs !== null) {
        assertParkSnapshot(input.parkActiveAs, active, input.activeKey);
        if ((await requestResult(parkedStore.get(input.parkActiveAs.id))) !== undefined)
          throw new Error('Parked active draft id already exists.');
        parkedActive = input.parkActiveAs;
        await requestResult(parkedStore.add(parkedActive));
      }
      const resolved: ParkedOrderDraft = {
        ...selected,
        state: 'RESTORED',
        resolvedAt: input.restoredAt,
        resolvedByWorkerId: input.restoredByWorkerId,
      };
      assertParkedOrderDraftInvariant(resolved);
      await requestResult(parkedStore.put(resolved));
      await requestResult(drafts.put(selected.draft));
      await completion;
      return { restoredDraft: selected.draft, parkedActive };
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async discardParked(input: ResolveParkedOrderDraftInput): Promise<ParkedOrderDraft> {
    const db = this.#requireDatabase();
    const tx = db.transaction(PARKED_STORE_NAME, 'readwrite', { durability: 'strict' });
    const completion = transactionDone(tx);
    const store = tx.objectStore(PARKED_STORE_NAME);
    try {
      const raw = await requestResult(store.get(input.parkedId));
      if (raw === undefined) throw new Error('Parked order draft was not found.');
      const selected = parseParked(raw);
      if (
        selected.shopId !== input.shopId ||
        selected.businessDayId !== input.businessDayId ||
        selected.state !== 'PARKED'
      )
        throw new Error('Parked order draft does not belong to the requested authority.');
      const resolved: ParkedOrderDraft = {
        ...selected,
        state: 'DISCARDED',
        resolvedAt: input.resolvedAt,
        resolvedByWorkerId: input.resolvedByWorkerId,
      };
      assertParkedOrderDraftInvariant(resolved);
      await requestResult(store.put(resolved));
      await completion;
      return resolved;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may already be complete; preserve the original error.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }
  #requireDatabase(): IDBDatabase {
    if (this.#database === null)
      throw new Error('IndexedDB order draft store must be initialized before use.');
    return this.#database;
  }
}
