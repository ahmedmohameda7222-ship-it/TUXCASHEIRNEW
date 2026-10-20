import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { shopCopyPreviewMatchesSelection } from './shopCopyPreviewGuard';

type CopyDomain = 'checkout' | 'receipts';
type CopyChange = {
  settingKey: string;
  sourceValue: unknown;
  source: 'shop' | 'business';
  sourceExpectedVersion: number;
  targetValue: unknown;
  targetSource: 'shop' | 'business' | 'unset';
  targetExpectedVersion: number | null;
  wouldChange: boolean;
};
type CopyPreview =
  | { ok: false; code: string; currentVersion?: number }
  | {
      ok: true;
      sourceShopId: string;
      targetShopId: string;
      selectedDomains: CopyDomain[];
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
  const authorizedShopNames = new Map(
    session.state.status === 'authenticated'
      ? (session.state.session.principal.shopSummaries ?? [])
          .filter((shop) => session.state.session.principal.shopIds.includes(shop.id))
          .map((shop) => [shop.id, shop.name] as const)
      : [],
  );
  const queryClient = useQueryClient();
  const [sourceShopId, setSourceShopId] = useState(sourceShopIds[0] ?? '');
  const activeSourceShopId = sourceShopIds.includes(sourceShopId)
    ? sourceShopId
    : (sourceShopIds[0] ?? '');
  const [domains, setDomains] = useState<CopyDomain[]>(['checkout']);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKeys, setCopiedKeys] = useState<{ count: number; targetShopId: string } | null>(
    null,
  );
  const currentPreview =
    preview?.ok &&
    shopCopyPreviewMatchesSelection(preview, {
      sourceShopId: activeSourceShopId,
      targetShopId,
      targetSettingsVersion: expectedTargetSettingsVersion,
      selectedDomains: domains,
    })
      ? preview
      : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !activeSourceShopId || domains.length === 0) return;
    setPending(true);
    setError(null);
    setPreview(null);
    setCopiedKeys(null);
    try {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<CopyPreview>(
        '/api/admin/shop-copy-preview',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceShopId: activeSourceShopId,
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

  async function applySelected() {
    if (pending || !currentPreview?.changes.some((change) => change.wouldChange)) return;
    const confirmedPreview = currentPreview;
    setPending(true);
    setError(null);
    setCopiedKeys(null);
    try {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<
        { ok: true; updatedKeys: string[]; publishRequired: boolean } | { ok: false; code: string }
      >(
        '/api/admin/shop-copy-preview',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'settings-copy.apply',
            sourceShopId: confirmedPreview.sourceShopId,
            targetShopId: confirmedPreview.targetShopId,
            selectedDomains: confirmedPreview.selectedDomains,
            expectedSourceSettingsVersion: confirmedPreview.sourceSettingsVersion,
            expectedTargetSettingsVersion: confirmedPreview.targetSettingsVersion,
            expectedChanges: confirmedPreview.changes,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code);
      setCopiedKeys({ count: result.updatedKeys.length, targetShopId });
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings', targetShopId] });
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error
          ? `Copy not applied: ${cause.message}. Refresh the preview and review both shops.`
          : 'Unable to apply settings copy.',
      );
    } finally {
      setPending(false);
    }
  }

  function toggle(domain: CopyDomain, checked: boolean) {
    setDomains((current) =>
      checked ? [...current, domain] : current.filter((item) => item !== domain),
    );
    setPreview(null);
    setCopiedKeys(null);
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
            value={activeSourceShopId}
            disabled={pending}
            onChange={(event) => {
              setSourceShopId(event.currentTarget.value);
              setPreview(null);
              setCopiedKeys(null);
            }}
          >
            {sourceShopIds.map((id) => (
              <option value={id} key={id}>
                {authorizedShopNames.get(id) ?? 'Shop unavailable'}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-field__help">
          Target shop: <strong>{authorizedShopNames.get(targetShopId) ?? 'Selected shop'}</strong>
        </p>
        <details className="admin-settings-advanced">
          <summary>Technical shop identifiers</summary>
          <small>Source: {activeSourceShopId}</small>
          <small>Target: {targetShopId}</small>
        </details>
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
      {copiedKeys?.targetShopId === targetShopId ? (
        <p role="status">
          {copiedKeys.count} settings copied as draft overrides. Publish the target shop settings to
          activate changes for future orders.
        </p>
      ) : null}
      {currentPreview ? (
        <div role="status">
          <p>
            Read-only preview: source settings version {currentPreview.sourceSettingsVersion},
            target settings version {currentPreview.targetSettingsVersion}.
          </p>
          {currentPreview.changes.filter((row) => row.wouldChange).length === 0 ? (
            <p>No configuration differences in the selected domains.</p>
          ) : (
            <ul>
              {currentPreview.changes
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
            Applying copies only the selected changed settings as unpublished target overrides.
            Publish the target shop settings afterward. Catalog, inventory and history are not
            copied.
          </p>
          <button
            className="admin-primary-button"
            type="button"
            disabled={pending || !currentPreview.changes.some((change) => change.wouldChange)}
            onClick={() => void applySelected()}
          >
            {pending ? 'Applying…' : 'Apply selected settings'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
