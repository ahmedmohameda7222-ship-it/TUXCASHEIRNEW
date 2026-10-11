import { useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type CreateShopDraft = {
  name: string;
  address: string;
  contactPhone: string;
  commandId: string;
};

type ShopCreateResult =
  { ok: true; shopId: string; idempotentReplay: boolean } | { ok: false; code: string };

export function CreateShopPanel({ contextShopId }: { contextShopId: string }) {
  const session = useAdminSession();
  const [draft, setDraft] = useState<CreateShopDraft | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    setError(null);
    setPending(true);
    try {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<ShopCreateResult>(
        '/api/admin/shop-create',
        {
          method: 'POST',
          body: JSON.stringify({
            contextShopId,
            name: draft.name.trim(),
            address: draft.address.trim() || null,
            contactPhone: draft.contactPhone.trim() || null,
            commandId: draft.commandId,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code);
      setCreatedId(result.shopId);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create shop.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-settings-card" aria-labelledby="admin-shop-create-title">
      <h3 id="admin-shop-create-title">Create shop</h3>
      <p className="admin-field__help">
        A new shop is linked to this business with order intake closed. No catalog, settings,
        inventory, or historical records are automatically copied.
      </p>
      {createdId ? (
        <>
          <p role="status">
            Shop created: {createdId}. Assign staff and publish its settings before opening
            operational and online ordering.
          </p>
          <button
            type="button"
            className="admin-secondary-button"
            disabled={pending}
            onClick={() => {
              setError(null);
              void session.refresh().catch(() => setError('Unable to refresh shop access.'));
            }}
          >
            Refresh available shops
          </button>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {!draft ? (
        <button
          type="button"
          className="admin-secondary-button"
          disabled={pending}
          onClick={() => {
            setCreatedId(null);
            setError(null);
            setDraft({
              name: '',
              address: '',
              contactPhone: '',
              commandId: crypto.randomUUID(),
            });
          }}
        >
          Add new shop
        </button>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label className="admin-field">
            <span>New shop name</span>
            <input
              required
              maxLength={120}
              value={draft.name}
              disabled={pending}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setDraft((current) => (current ? { ...current, name } : current));
              }}
            />
          </label>
          <label className="admin-field">
            <span>New shop address (optional)</span>
            <input
              maxLength={500}
              value={draft.address}
              disabled={pending}
              onChange={(event) => {
                const address = event.currentTarget.value;
                setDraft((current) => (current ? { ...current, address } : current));
              }}
            />
          </label>
          <label className="admin-field">
            <span>New shop contact phone (optional)</span>
            <input
              maxLength={80}
              value={draft.contactPhone}
              disabled={pending}
              onChange={(event) => {
                const contactPhone = event.currentTarget.value;
                setDraft((current) => (current ? { ...current, contactPhone } : current));
              }}
            />
          </label>
          <div className="admin-settings-row__main">
            <button type="submit" className="admin-primary-button" disabled={pending}>
              {pending ? 'Creating…' : 'Create shop'}
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={pending}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
