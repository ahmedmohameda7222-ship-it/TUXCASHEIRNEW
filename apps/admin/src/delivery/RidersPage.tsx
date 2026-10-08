import type { AdminDeliveryRider } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { EmptyState } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';

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
  canManage,
  onSave,
}: {
  riders: readonly AdminDeliveryRider[];
  saving: boolean;
  canManage: boolean;
  onSave(input: DeliveryRiderDraft): void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = riders.find((rider) => rider.id === editingId) ?? null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState(true);
  const [state, setState] = useState<AdminDeliveryRider['state']>('AVAILABLE');

  function begin(rider: AdminDeliveryRider | null) {
    if (!canManage) return;
    setEditingId(rider?.id ?? '');
    setName(rider?.displayName ?? '');
    setPhone(rider?.phone ?? '');
    setActive(rider?.active ?? true);
    setState(rider?.state ?? 'AVAILABLE');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !name.trim()) return;
    onSave({
      riderId: editing?.id ?? null,
      expectedVersion: editing?.version ?? null,
      displayName: name.trim(),
      phone: phone.trim() || null,
      active,
      state,
    });
  }

  const formOpen = editingId !== null && canManage;

  return (
    <section aria-label="Delivery riders">
      <header className="admin-section-header">
        <div>
          <h2>Riders</h2>
          <p>Manage rider availability and contact details for this shop.</p>
        </div>
        {canManage ? (
          <button className="admin-primary-button" type="button" onClick={() => begin(null)}>
            New rider
          </button>
        ) : null}
      </header>

      {riders.length === 0 ? (
        <EmptyState
          title="No riders yet"
          description={
            canManage
              ? 'Add a rider when delivery coverage is ready.'
              : 'No riders are configured for this shop.'
          }
        />
      ) : (
        <ul>
          {riders.map((rider) => (
            <li key={rider.id}>
              {canManage ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => begin(rider)}
                >
                  {rider.displayName} ·{' '}
                  {rider.state === 'AVAILABLE' ? 'Available for delivery' : 'Not available'} ·{' '}
                  {rider.active ? 'Active' : 'Inactive'}
                </button>
              ) : (
                <span className="admin-secondary-button" aria-disabled="true">
                  {rider.displayName} ·{' '}
                  {rider.state === 'AVAILABLE' ? 'Available for delivery' : 'Not available'} ·{' '}
                  {rider.active ? 'Active' : 'Inactive'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <AdminDialog
          open
          variant="sheet"
          title={editing ? 'Edit rider' : 'New rider'}
          description="Manage the rider's contact details and current availability."
          onOpenChange={(open) => {
            if (!open && !saving) setEditingId(null);
          }}
        >
          <form onSubmit={submit} aria-label="Delivery rider editor">
            <label className="admin-field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="admin-field">
              <span>Phone</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label className="admin-field">
              <span>Availability</span>
              <select
                value={state}
                onChange={(event) => setState(event.target.value as AdminDeliveryRider['state'])}
              >
                <option value="AVAILABLE">Available for delivery</option>
                <option value="UNAVAILABLE">Not available</option>
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
              <button className="admin-primary-button" type="submit" disabled={saving}>
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
        </AdminDialog>
      ) : null}
    </section>
  );
}
