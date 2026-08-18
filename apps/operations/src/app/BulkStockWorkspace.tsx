import type {
  BulkStockBoard,
  BulkStockBoardItem,
  BulkStockMutation,
} from '@tux/application';
import type { InventoryMovementId } from '@tux/domain';
import { useEffect, useState, type FormEvent } from 'react';
import type { OperationsBulkStockClient } from './sessionClient';

interface UndoNotice {
  readonly movementId: InventoryMovementId;
  readonly label: string;
  readonly undoUntil: string;
}

function unitText(item: BulkStockBoardItem): string {
  const label = item.unitLabel.trim();
  return label.length === 0 ? 'units' : label;
}

function AddStockDialog({
  item,
  busy,
  error,
  onClose,
  onAdd,
}: {
  readonly item: BulkStockBoardItem;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onAdd: (units: number) => Promise<void>;
}) {
  const [unitsText, setUnitsText] = useState('');
  const units = /^\d+$/.test(unitsText) ? Number(unitsText) : 0;
  const valid = Number.isSafeInteger(units) && units > 0;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!busy && valid) await onAdd(units);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="bulk-stock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-stock-add-title"
        onSubmit={(event) => void submit(event)}
      >
        <header className="bulk-stock-dialog-heading">
          <div>
            <p className="eyebrow">Physical stock received</p>
            <h2 id="bulk-stock-add-title">Add Stock — {item.name}</h2>
          </div>
          <button type="button" className="quiet-action" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </header>
        <label className="bulk-stock-quantity-field" htmlFor="bulk-stock-add-units">
          Whole units received
          <input
            id="bulk-stock-add-units"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={unitsText}
            disabled={busy}
            onChange={(event) => setUnitsText(event.target.value.replace(/\D/g, ''))}
          />
          <span>{unitText(item)} only — this does not create a Purchase or Expense.</span>
        </label>
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-action" disabled={busy || !valid}>
          {busy ? 'Saving locally…' : 'Add Stock'}
        </button>
      </form>
    </div>
  );
}

export function BulkStockWorkspace({ client }: { readonly client: OperationsBulkStockClient }) {
  const [board, setBoard] = useState<BulkStockBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [addItem, setAddItem] = useState<BulkStockBoardItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoNotice | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    const result = await client.loadBoard();
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setBoard(result.value);
  }

  useEffect(() => {
    void load();
  }, [client]);

  useEffect(() => {
    if (undo === null) return;
    const delay = Math.max(0, Date.parse(undo.undoUntil) - Date.now());
    const timer = window.setTimeout(() => setUndo(null), delay);
    return () => window.clearTimeout(timer);
  }, [undo]);

  function showUndo(mutation: BulkStockMutation, label: string): void {
    if (mutation.undoUntil === null) {
      setUndo(null);
      return;
    }
    setUndo({ movementId: mutation.movement.id, label, undoUntil: mutation.undoUntil });
  }

  async function finishOne(item: BulkStockBoardItem): Promise<void> {
    setBusyItemId(item.id);
    setError(null);
    const result = await client.finishOne({ itemId: item.id, commandId: crypto.randomUUID() });
    setBusyItemId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    showUndo(result.value, `${item.name}: finished 1`);
    await load();
  }

  async function addStock(item: BulkStockBoardItem, units: number): Promise<void> {
    setBusyItemId(item.id);
    setDialogError(null);
    const result = await client.addStock({
      itemId: item.id,
      units,
      commandId: crypto.randomUUID(),
    });
    setBusyItemId(null);
    if (!result.ok) {
      setDialogError(result.error.message);
      return;
    }
    setAddItem(null);
    showUndo(result.value, `${item.name}: added ${units} ${unitText(item)}`);
    await load();
  }

  async function undoLast(): Promise<void> {
    const current = undo;
    if (current === null) return;
    setBusyItemId('undo');
    setError(null);
    const result = await client.undoMovement({
      movementId: current.movementId,
      commandId: crypto.randomUUID(),
    });
    setBusyItemId(null);
    if (!result.ok) {
      setUndo(null);
      setError(result.error.message);
      return;
    }
    setUndo(null);
    await load();
  }

  return (
    <main className="bulk-stock-workspace" aria-labelledby="bulk-stock-title">
      <header className="bulk-stock-page-heading">
        <div>
          <p className="eyebrow">Physical whole-unit ledger</p>
          <h1 id="bulk-stock-title">Bulk Stock</h1>
          <p>Record only when a whole unit finishes or new physical stock arrives.</p>
        </div>
      </header>

      {error === null ? null : (
        <p className="form-error bulk-stock-page-error" role="alert">
          {error}
        </p>
      )}

      {loading && board === null ? (
        <p className="bulk-stock-empty">Loading local Bulk Stock…</p>
      ) : board === null || board.items.length === 0 ? (
        <section className="bulk-stock-empty">
          <h2>No active Bulk Stock items</h2>
          <p>Items are configured in TUX Admin, not from the worker Operations screen.</p>
        </section>
      ) : (
        <section className="bulk-stock-grid" aria-label="Bulk Stock items">
          {board.items.map((item) => (
            <article className="bulk-stock-card" key={item.id}>
              <div className="bulk-stock-card-main">
                <h2>{item.name}</h2>
                <span>Current Stock</span>
                <strong className="bulk-stock-balance">
                  {item.currentWholeUnits} <small>{unitText(item)}</small>
                </strong>
              </div>
              <div className="bulk-stock-card-actions">
                <button
                  type="button"
                  className="bulk-stock-finished-action"
                  disabled={busyItemId !== null}
                  onClick={() => void finishOne(item)}
                >
                  {busyItemId === item.id ? 'Saving…' : 'Finished 1'}
                </button>
                <button
                  type="button"
                  className="bulk-stock-add-action"
                  disabled={busyItemId !== null}
                  onClick={() => {
                    setDialogError(null);
                    setAddItem(item);
                  }}
                >
                  Add Stock
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {undo === null ? null : (
        <div className="bulk-stock-undo" role="status" aria-live="polite">
          <span>{undo.label}</span>
          <button type="button" disabled={busyItemId !== null} onClick={() => void undoLast()}>
            {busyItemId === 'undo' ? 'Undoing…' : 'Undo'}
          </button>
        </div>
      )}

      {addItem === null ? null : (
        <AddStockDialog
          item={addItem}
          busy={busyItemId !== null}
          error={dialogError}
          onClose={() => {
            if (busyItemId === null) {
              setDialogError(null);
              setAddItem(null);
            }
          }}
          onAdd={(units) => addStock(addItem, units)}
        />
      )}
    </main>
  );
}
