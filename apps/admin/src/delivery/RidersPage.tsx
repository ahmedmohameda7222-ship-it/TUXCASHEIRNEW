import type { AdminDeliveryRider } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

export type DeliveryRiderDraft = {
  riderId: string | null;
  expectedVersion: number | null;
  displayName: string;
  phone: string | null;
  active: boolean;
  state: AdminDeliveryRider['state'];
};

export function RidersPage({
  riders,
  saving,
  onSave,
}: {
  riders: readonly AdminDeliveryRider[];
  saving: boolean;
  onSave(input: DeliveryRiderDraft): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = riders.find((rider) => rider.id === editingId) ?? null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState(true);
  const [state, setState] =
    useState<AdminDeliveryRider['state']>('AVAILABLE');

  function begin(rider: AdminDeliveryRider | null) {
    setEditingId(rider?.id ?? '');
    setName(rider?.displayName ?? '');
    setPhone(rider?.phone ?? '');
    setActive(rider?.active ?? true);
    setState(rider?.state ?? 'AVAILABLE');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      riderId: editing?.id ?? null,
      expectedVersion: editing?.version ?? null,
      displayName: name.trim(),
      phone: phone.trim() || null,
      active,
      state,
    });
  }

  const formOpen = editingId !== null;

  return (
    <section aria-label="Delivery riders">
      <header>
        <h2>Riders</h2>
        <button
          className="admin-primary-button"
          type="button"
          onClick={() => begin(null)}
        >
          New rider
        </button>
      </header>

      {riders.length === 0 ? (
        <p>No riders configured.</p>
      ) : (
        <ul>
          {riders.map((rider) => (
            <li key={rider.id}>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => begin(rider)}
              >
                {rider.displayName} · {rider.state} ·{' '}
                {rider.active ? 'Active' : 'Inactive'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <form onSubmit={submit} aria-label="Delivery rider editor">
          <h3>{editing ? 'Edit rider' : 'New rider'}</h3>
          <label className="admin-field">
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="admin-field">
            <span>Phone</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Availability</span>
            <select
              value={state}
              onChange={(event) =>
                setState(event.target.value as AdminDeliveryRider['state'])
              }
            >
              <option value="AVAILABLE">AVAILABLE</option>
              <option value="UNAVAILABLE">UNAVAILABLE</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Active
          </label>
          <div className="admin-actions">
            <button
              className="admin-primary-button"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save rider'}
            </button>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setEditingId(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
