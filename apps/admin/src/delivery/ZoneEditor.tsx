import type { AdminDeliveryZone, AdminDeliveryZoneBoundary } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

export type DeliveryZoneDraft = {
  zoneId: string | null;
  expectedVersion: number | null;
  name: string;
  feeMinor: number;
  minimumOrderMinor: number;
  priority: number;
  active: boolean;
  boundary: AdminDeliveryZoneBoundary;
  fallbackShopId: string | null;
  fallbackEnabled: boolean;
};

type FallbackShopOption = {
  id: string;
  label: string;
};

function initialBoundary(zone: AdminDeliveryZone | null): AdminDeliveryZoneBoundary {
  return (
    zone?.boundary ?? {
      kind: 'RADIUS',
      latitude: 30.0444,
      longitude: 31.2357,
      radiusMeters: 3000,
    }
  );
}

function formatMinorInput(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

function parseMinorInput(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;
  const minor = whole * 100 + fraction;
  return Number.isSafeInteger(minor) ? minor : null;
}

export function ZoneEditor({
  zone,
  saving,
  fallbackShops,
  onSave,
  onCancel,
}: {
  zone: AdminDeliveryZone | null;
  saving: boolean;
  fallbackShops: readonly FallbackShopOption[];
  onSave(input: DeliveryZoneDraft): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [feeAmount, setFeeAmount] = useState(formatMinorInput(zone?.feeMinor ?? 0));
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(
    formatMinorInput(zone?.minimumOrderMinor ?? 0),
  );
  const [priority, setPriority] = useState(String(zone?.priority ?? 0));
  const [active, setActive] = useState(zone?.active ?? true);
  const [boundary, setBoundary] = useState<AdminDeliveryZoneBoundary>(initialBoundary(zone));
  const [fallbackEnabled, setFallbackEnabled] = useState(zone?.fallbackEnabled ?? false);
  const [fallbackShopId, setFallbackShopId] = useState(zone?.fallbackShopId ?? '');

  useEffect(() => {
    setName(zone?.name ?? '');
    setFeeAmount(formatMinorInput(zone?.feeMinor ?? 0));
    setMinimumOrderAmount(formatMinorInput(zone?.minimumOrderMinor ?? 0));
    setPriority(String(zone?.priority ?? 0));
    setActive(zone?.active ?? true);
    setBoundary(initialBoundary(zone));
    setFallbackEnabled(zone?.fallbackEnabled ?? false);
    setFallbackShopId(zone?.fallbackShopId ?? '');
  }, [zone]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fee = parseMinorInput(feeAmount);
    const minimum = parseMinorInput(minimumOrderAmount);
    const zonePriority = Number(priority);
    if (
      !name.trim() ||
      fee === null ||
      minimum === null ||
      !Number.isSafeInteger(zonePriority) ||
      (fallbackEnabled && !fallbackShopId)
    ) {
      return;
    }
    onSave({
      zoneId: zone?.id ?? null,
      expectedVersion: zone?.version ?? null,
      name: name.trim(),
      feeMinor: fee,
      minimumOrderMinor: minimum,
      priority: zonePriority,
      active,
      boundary,
      fallbackShopId: fallbackEnabled ? fallbackShopId : null,
      fallbackEnabled,
    });
  }

  const configuredFallbackUnavailable = Boolean(
    fallbackShopId && !fallbackShops.some((option) => option.id === fallbackShopId),
  );

  return (
    <AdminDialog
      open
      variant="sheet"
      title={zone ? 'Edit delivery zone' : 'New delivery zone'}
      description="Set the fee, minimum order, and the area this zone covers."
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <form onSubmit={submit} aria-label="Delivery zone editor">
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Delivery fee (EGP)</span>
          <input
            inputMode="decimal"
            value={feeAmount}
            onChange={(event) => setFeeAmount(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Minimum order (EGP)</span>
          <input
            inputMode="decimal"
            value={minimumOrderAmount}
            onChange={(event) => setMinimumOrderAmount(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Coverage type</span>
          <select
            value={boundary.kind}
            onChange={(event) =>
              setBoundary(
                event.target.value === 'POLYGON'
                  ? {
                      kind: 'POLYGON',
                      points: [
                        { latitude: 30.04, longitude: 31.23 },
                        { latitude: 30.05, longitude: 31.23 },
                        { latitude: 30.05, longitude: 31.24 },
                      ],
                    }
                  : {
                      kind: 'RADIUS',
                      latitude: 30.0444,
                      longitude: 31.2357,
                      radiusMeters: 3000,
                    },
              )
            }
          >
            <option value="RADIUS">Radius</option>
            <option value="POLYGON">Polygon</option>
          </select>
        </label>

        {boundary.kind === 'RADIUS' ? (
          <>
            <label className="admin-field">
              <span>Radius (meters)</span>
              <input
                inputMode="numeric"
                value={boundary.radiusMeters}
                onChange={(event) =>
                  setBoundary({
                    ...boundary,
                    radiusMeters: Number(event.target.value),
                  })
                }
              />
            </label>
            <details>
              <summary>Advanced coordinates</summary>
              <label className="admin-field">
                <span>Center latitude</span>
                <input
                  inputMode="decimal"
                  value={boundary.latitude}
                  onChange={(event) =>
                    setBoundary({ ...boundary, latitude: Number(event.target.value) })
                  }
                />
              </label>
              <label className="admin-field">
                <span>Center longitude</span>
                <input
                  inputMode="decimal"
                  value={boundary.longitude}
                  onChange={(event) =>
                    setBoundary({ ...boundary, longitude: Number(event.target.value) })
                  }
                />
              </label>
            </details>
          </>
        ) : (
          <fieldset className="admin-choice-list">
            <legend>Coverage points</legend>
            {boundary.points.map((point, index) => (
              <div className="admin-actions" key={`point-${index}`}>
                <label className="admin-field">
                  <span>Point {index + 1} latitude</span>
                  <input
                    inputMode="decimal"
                    value={point.latitude}
                    onChange={(event) =>
                      setBoundary({
                        kind: 'POLYGON',
                        points: boundary.points.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, latitude: Number(event.target.value) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <label className="admin-field">
                  <span>Point {index + 1} longitude</span>
                  <input
                    inputMode="decimal"
                    value={point.longitude}
                    onChange={(event) =>
                      setBoundary({
                        kind: 'POLYGON',
                        points: boundary.points.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, longitude: Number(event.target.value) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={boundary.points.length <= 3}
                  onClick={() =>
                    setBoundary({
                      kind: 'POLYGON',
                      points: boundary.points.filter(
                        (_, candidateIndex) => candidateIndex !== index,
                      ),
                    })
                  }
                >
                  Remove point
                </button>
              </div>
            ))}
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() =>
                setBoundary({
                  kind: 'POLYGON',
                  points: [
                    ...boundary.points,
                    boundary.points.at(-1) ?? { latitude: 30.0444, longitude: 31.2357 },
                  ],
                })
              }
            >
              Add point
            </button>
          </fieldset>
        )}

        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
        <label>
          <input
            type="checkbox"
            checked={fallbackEnabled}
            onChange={(event) => setFallbackEnabled(event.target.checked)}
          />
          Use fallback shop
        </label>
        {fallbackEnabled ? (
          <label className="admin-field">
            <span>Fallback shop</span>
            <select
              value={fallbackShopId}
              onChange={(event) => setFallbackShopId(event.target.value)}
            >
              <option value="">Select a shop</option>
              {configuredFallbackUnavailable ? (
                <option value={fallbackShopId}>Current configured fallback</option>
              ) : null}
              {fallbackShops.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="admin-actions">
          <button className="admin-primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save delivery zone'}
          </button>
          <button className="admin-secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
