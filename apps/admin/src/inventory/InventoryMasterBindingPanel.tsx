import type { AdminInventoryItem } from '@tux/admin-contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type LocalItem = Pick<
  AdminInventoryItem,
  'id' | 'name' | 'unitLabel' | 'trackingMode' | 'active'
>;

type Master = {
  id: string;
  canonicalName: string;
  baseUnitLabel: string;
  trackingMode: 'RECIPE_TRACKED';
  inventoryItemId: string | null;
  inventoryItemName: string | null;
};

type MasterResponse = {
  ok: true;
  shopId: string;
  masters: Master[];
};

type BindResult = {
  ok: boolean;
  code?: string;
  masterInventoryItemId?: string;
};

export function InventoryMasterBindingPanel({
  shopId,
  items,
  onBack,
}: {
  shopId: string;
  items: readonly LocalItem[];
  onBack(): void;
}) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const eligible = items.filter((item) => item.active && item.trackingMode === 'RECIPE_TRACKED');
  const [itemId, setItemId] = useState(eligible[0]?.id ?? '');
  const [mode, setMode] = useState<'create' | 'attach'>('create');
  const [name, setName] = useState('');
  const [masterId, setMasterId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const retainedCommandId = useRef<string | null>(null);

  const mastersQuery = useQuery({
    queryKey: ['admin', 'inventory-master', shopId],
    queryFn: () =>
      adminFetch<MasterResponse>(
        `/api/admin/inventory-master?shopId=${encodeURIComponent(shopId)}`,
      ),
  });
  const masters = mastersQuery.data?.masters ?? [];
  const item = eligible.find((candidate) => candidate.id === itemId) ?? null;
  const existing = masters.find((master) => master.inventoryItemId === item?.id);
  const compatible = masters.filter(
    (master) =>
      master.baseUnitLabel === item?.unitLabel &&
      master.trackingMode === 'RECIPE_TRACKED' &&
      master.inventoryItemId === null,
  );

  function changed() {
    retainedCommandId.current = null;
    setError('');
    setSuccess('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || existing || pending || session.state.status !== 'authenticated') return;
    if (mode === 'create' && !name.trim()) {
      setError('Enter a business-wide inventory master name.');
      return;
    }
    if (mode === 'attach' && !compatible.some((candidate) => candidate.id === masterId)) {
      setError('Select an existing master with the exact same base unit.');
      return;
    }
    setPending(true);
    setError('');
    setSuccess('');
    if (!retainedCommandId.current) retainedCommandId.current = crypto.randomUUID();
    try {
      const result = await adminFetch<BindResult>(
        '/api/admin/inventory-master',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'master.bind',
            shopId,
            inventoryItemId: item.id,
            masterInventoryItemId: mode === 'attach' ? masterId : null,
            canonicalName: mode === 'create' ? name.trim() : null,
            commandId: retainedCommandId.current,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code ?? 'inventory_master_binding_failed');
      retainedCommandId.current = null;
      setSuccess('Inventory master binding saved. Other shops require explicit binding.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'inventory-master', shopId] });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save inventory master binding.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-inventory-workflow" aria-label="Recipe inventory master bindings">
      <div className="admin-inventory-workflow__header">
        <div>
          <p className="admin-page__eyebrow">Catalog Copy dependencies</p>
          <h2>Recipe inventory master bindings</h2>
        </div>
        <button type="button" className="admin-secondary-button" onClick={onBack}>
          Back to inventory
        </button>
      </div>
      <p>
        Match items only after verifying their physical base units. Each shop uses its own
        inventory item ID. No stock balances, costs or purchase conversions are transferred.
      </p>
      {mastersQuery.isLoading ? <p role="status">Loading inventory masters…</p> : null}
      {mastersQuery.isError ? (
        <p role="alert">Inventory master identities could not be loaded.</p>
      ) : null}
      {mastersQuery.isSuccess ? (
        <>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              Shop inventory item
              <select
                value={item?.id ?? ''}
                onChange={(event) => {
                  setItemId(event.currentTarget.value);
                  changed();
                }}
              >
                {eligible.map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.name} ({row.unitLabel})
                  </option>
                ))}
              </select>
            </label>
            {existing ? (
              <p role="status">
                Already bound to {existing.canonicalName} ({existing.baseUnitLabel}).
              </p>
            ) : (
              <>
                <fieldset>
                  <legend>Binding action</legend>
                  <label>
                    <input
                      type="radio"
                      name="inventory-master-mode"
                      value="create"
                      checked={mode === 'create'}
                      onChange={() => {
                        setMode('create');
                        changed();
                      }}
                    />
                    Create a new business inventory master
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="inventory-master-mode"
                      value="attach"
                      checked={mode === 'attach'}
                      onChange={() => {
                        setMode('attach');
                        changed();
                      }}
                    />
                    Attach to an existing master
                  </label>
                </fieldset>
                {mode === 'create' ? (
                  <label>
                    Master name
                    <input
                      value={name}
                      maxLength={160}
                      onChange={(event) => {
                        setName(event.currentTarget.value);
                        changed();
                      }}
                      placeholder="Business-wide ingredient identity"
                    />
                  </label>
                ) : (
                  <label>
                    Existing compatible master
                    <select
                      value={compatible.some((row) => row.id === masterId) ? masterId : ''}
                      onChange={(event) => {
                        setMasterId(event.currentTarget.value);
                        changed();
                      }}
                    >
                      <option value="">Select verified master</option>
                      {compatible.map((master) => (
                        <option key={master.id} value={master.id}>
                          {master.canonicalName} ({master.baseUnitLabel})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="submit"
                  className="admin-primary-button"
                  disabled={pending || !item || (mode === 'attach' && compatible.length === 0)}
                >
                  {pending ? 'Saving binding…' : 'Save explicit mapping'}
                </button>
              </>
            )}
          </form>
          <h3>Business inventory masters</h3>
          {masters.length === 0 ? (
            <p>No master identities yet. Create one from an existing tracked item.</p>
          ) : (
            <ul>
              {masters.map((master) => (
                <li key={master.id}>
                  {master.canonicalName} ({master.baseUnitLabel}) —{' '}
                  {master.inventoryItemName ?? 'Unbound in this shop'}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {success ? <p role="status">{success}</p> : null}
    </section>
  );
}
