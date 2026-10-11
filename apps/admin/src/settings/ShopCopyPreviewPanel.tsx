import { useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type CopyDomain = 'checkout' | 'receipts';
type CopyChange = {
  settingKey: string;
  sourceValue: unknown;
  source: 'shop' | 'business';
  targetValue: unknown;
  targetSource: 'shop' | 'business' | 'unset';
  targetExpectedVersion: number | null;
  wouldChange: boolean;
};
type CopyPreview =
  | { ok: false; code: string; currentVersion?: number }
  | {
      ok: true;
      sourceSettingsVersion: number;
      targetSettingsVersion: number;
      changes: CopyChange[];
    };

export function ShopCopyPreviewPanel({
  targetShopId,
  expectedTargetSettingsVersion,
  sourceShopIds,
}: {
  targetShopId: string;
  expectedTargetSettingsVersion: number;
  sourceShopIds: readonly string[];
}) {
  const session = useAdminSession();
  const [sourceShopId, setSourceShopId] = useState(sourceShopIds[0] ?? '');
  const [domains, setDomains] = useState<CopyDomain[]>(['checkout']);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !sourceShopId || domains.length === 0) return;
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<CopyPreview>(
        '/api/admin/shop-copy-preview',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceShopId,
            targetShopId,
            selectedDomains: domains,
            expectedTargetSettingsVersion,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code);
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to preview copy.');
    } finally {
      setPending(false);
    }
  }

  function toggle(domain: CopyDomain, checked: boolean) {
    setDomains((current) =>
      checked ? [...current, domain] : current.filter((item) => item !== domain),
    );
    setPreview(null);
  }

  if (sourceShopIds.length === 0) return null;
  return (
    <section className="admin-settings-card" aria-labelledby="shop-copy-preview-title">
      <h3 id="shop-copy-preview-title">Selective settings copy preview</h3>
      <p className="admin-field__help">
        Compare explicitly selected checkout or receipt settings from another authorized shop. This
        preview does not modify either shop. Catalog requires its separate draft/publish authority.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="admin-field">
          <span>Source shop</span>
          <select
            value={sourceShopId}
            disabled={pending}
            onChange={(event) => {
              setSourceShopId(event.currentTarget.value);
              setPreview(null);
            }}
          >
            {sourceShopIds.map((id) => (
              <option value={id} key={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-field__help">Target shop: {targetShopId}</p>
        <label className="admin-field">
          <input
            type="checkbox"
            checked={domains.includes('checkout')}
            disabled={pending}
            onChange={(event) => toggle('checkout', event.currentTarget.checked)}
          />
          Checkout configuration
        </label>
        <label className="admin-field">
          <input
            type="checkbox"
            checked={domains.includes('receipts')}
            disabled={pending}
            onChange={(event) => toggle('receipts', event.currentTarget.checked)}
          />
          Receipt configuration
        </label>
        <button
          className="admin-secondary-button"
          type="submit"
          disabled={pending || domains.length === 0}
        >
          {pending ? 'Comparing…' : 'Preview selected configuration'}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {preview?.ok ? (
        <div role="status">
          <p>
            Read-only preview: source settings version {preview.sourceSettingsVersion}, target
            settings version {preview.targetSettingsVersion}.
          </p>
          {preview.changes.filter((row) => row.wouldChange).length === 0 ? (
            <p>No configuration differences in the selected domains.</p>
          ) : (
            <ul>
              {preview.changes
                .filter((row) => row.wouldChange)
                .map((row) => (
                  <li key={row.settingKey}>
                    <strong>{row.settingKey}</strong>: {JSON.stringify(row.targetValue)} →{' '}
                    {JSON.stringify(row.sourceValue)} ({row.targetSource} → {row.source}; target row
                    version {row.targetExpectedVersion ?? 'unset'})
                  </li>
                ))}
            </ul>
          )}
          <p>
            Nothing has been copied. Applying selected changes requires a separate reviewed,
            version-fenced action.
          </p>
        </div>
      ) : null}
    </section>
  );
}
