import type { AdminDeliveryZone, AdminDeliveryZoneBoundary } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

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

export function ZoneEditor({
  zone,
  saving,
  onSave,
  onCancel,
}: {
  zone: AdminDeliveryZone | null;
  saving: boolean;
  onSave(input: DeliveryZoneDraft): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(zone?.name ?? '');
  const [feeMinor, setFeeMinor] = useState(String(zone?.feeMinor ?? 0));
  const [minimumOrderMinor, setMinimumOrderMinor] = useState(String(zone?.minimumOrderMinor ?? 0));
  const [priority, setPriority] = useState(String(zone?.priority ?? 0));
  const [active, setActive] = useState(zone?.active ?? true);
  const [boundary, setBoundary] = useState<AdminDeliveryZoneBoundary>(initialBoundary(zone));
  const [fallbackEnabled, setFallbackEnabled] = useState(zone?.fallbackEnabled ?? false);
  const [fallbackShopId, setFallbackShopId] = useState(zone?.fallbackShopId ?? '');

  useEffect(() => {
    setName(zone?.name ?? '');
    setFeeMinor(String(zone?.feeMinor ?? 0));
    setMinimumOrderMinor(String(zone?.minimumOrderMinor ?? 0));
    setPriority(String(zone?.priority ?? 0));
    setActive(zone?.active ?? true);
    setBoundary(initialBoundary(zone));
    setFallbackEnabled(zone?.fallbackEnabled ?? false);
    setFallbackShopId(zone?.fallbackShopId ?? '');
  }, [zone]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fee = Number(feeMinor);
    const minimum = Number(minimumOrderMinor);
    const zonePriority = Number(priority);
    if (
      !name.trim() ||
      !Number.isSafeInteger(fee) ||
      fee < 0 ||
      !Number.isSafeInteger(minimum) ||
      minimum < 0 ||
      !Number.isSafeInteger(zonePriority)
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
      fallbackShopId: fallbackEnabled && fallbackShopId.trim() ? fallbackShopId.trim() : null,
      fallbackEnabled,
    });
  }

  return (
    <form onSubmit={submit} aria-label="Delivery zone editor">
      <h3>{zone ? 'Edit delivery zone' : 'New delivery zone'}</h3>
      <label className="admin-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="admin-field">
        <span>Delivery fee minor</span>
        <input
          inputMode="numeric"
          value={feeMinor}
          onChange={(event) => setFeeMinor(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Minimum order minor</span>
        <input
          inputMode="numeric"
          value={minimumOrderMinor}
          onChange={(event) => setMinimumOrderMinor(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Priority</span>
        <input
          inputMode="numeric"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Boundary type</span>
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
            <span>Latitude</span>
            <input
              inputMode="decimal"
              value={boundary.latitude}
              onChange={(event) =>
                setBoundary({
                  ...boundary,
                  latitude: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="admin-field">
            <span>Longitude</span>
            <input
              inputMode="decimal"
              value={boundary.longitude}
              onChange={(event) =>
                setBoundary({
                  ...boundary,
                  longitude: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="admin-field">
            <span>Radius meters</span>
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
        </>
      ) : (
        <label className="admin-field">
          <span>Polygon points (latitude,longitude per line)</span>
          <textarea
            value={boundary.points
              .map((point) => `${point.latitude},${point.longitude}`)
              .join('\n')}
            onChange={(event) => {
              const points = event.target.value
                .split('\n')
                .map((line) => line.split(',').map(Number))
                .filter(
                  (point) => point.length === 2 && point.every((value) => Number.isFinite(value)),
                )
                .map(([latitude, longitude]) => ({
                  latitude: latitude!,
                  longitude: longitude!,
                }));
              setBoundary({ kind: 'POLYGON', points });
            }}
          />
        </label>
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
        Explicit fallback enabled
      </label>
      {fallbackEnabled ? (
        <label className="admin-field">
          <span>Fallback shop ID</span>
          <input
            value={fallbackShopId}
            onChange={(event) => setFallbackShopId(event.target.value)}
          />
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
  );
}
