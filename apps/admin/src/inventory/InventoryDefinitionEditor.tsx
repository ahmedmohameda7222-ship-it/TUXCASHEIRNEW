import type { AdminInventoryDefinitionCommand, AdminInventoryItem, AdminInventoryUnitConversion } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { parsePurchaseDecimalMicros } from '../purchasing/purchaseOrderDraft';

type DefinitionInput = Pick<AdminInventoryDefinitionCommand, 'type' | 'entityId' | 'expectedVersion' | 'payload'>;

type ConversionDraft = {
  id: string | null;
  expectedVersion: number | null;
  label: string;
  baseQuantity: string;
};

function conversionToDraft(conversion: AdminInventoryUnitConversion): ConversionDraft {
  return {
    id: conversion.id, expectedVersion: conversion.definitionVersion,
    label: conversion.purchaseUnitLabel,
    baseQuantity: String(conversion.baseMicrosPerPurchaseUnit / 1_000_000),
  };
}

function thresholdMicros(value: string): number | null | undefined {
  if (!value.trim()) return null;
  if (value.trim() === '0') return 0;
  return parsePurchaseDecimalMicros(value) ?? undefined;
}

export function InventoryDefinitionEditor({
  item, pending, onCommand, onClose,
}: {
  item: AdminInventoryItem | null;
  pending: boolean;
  onCommand(input: DefinitionInput, onSuccess: (entityId?: string) => void): void;
  onClose(): void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [unitLabel, setUnitLabel] = useState(item?.unitLabel ?? '');
  const [trackingMode, setTrackingMode] = useState(item?.trackingMode ?? 'RECIPE_TRACKED');
  const [threshold, setThreshold] = useState(item?.lowStockThresholdMicros === null || item?.lowStockThresholdMicros === undefined
    ? '' : String(item.lowStockThresholdMicros / 1_000_000));
  const [conversion, setConversion] = useState<ConversionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(item?.name ?? '');
    setUnitLabel(item?.unitLabel ?? '');
    setTrackingMode(item?.trackingMode ?? 'RECIPE_TRACKED');
    setThreshold(item?.lowStockThresholdMicros === null || item?.lowStockThresholdMicros === undefined
      ? '' : String(item.lowStockThresholdMicros / 1_000_000));
    setConversion(null);
    setError(null);
  }, [item?.id, item?.definitionVersion, item?.name, item?.unitLabel, item?.trackingMode, item?.lowStockThresholdMicros]);

  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const micros = thresholdMicros(threshold);
    if (!name.trim() || !unitLabel.trim() || micros === undefined) {
      setError('Enter valid item details and a non-negative threshold with up to 6 decimals.');
      return;
    }
    setError(null);
    onCommand({
      type: item ? 'item.update' : 'item.create',
      entityId: item?.id ?? null,
      expectedVersion: item?.definitionVersion ?? null,
      payload: {
        name: name.trim(), unitLabel: unitLabel.trim(), trackingMode,
        lowStockThresholdMicros: micros,
      },
    }, (entityId) => { if (!item && entityId) onClose(); });
  }

  function submitConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !conversion) return;
    const baseMicrosPerPurchaseUnit = parsePurchaseDecimalMicros(conversion.baseQuantity);
    if (!baseMicrosPerPurchaseUnit || !conversion.label.trim()
        || conversion.label.trim().toLocaleLowerCase('en') === item.unitLabel.trim().toLocaleLowerCase('en')) {
      setError('Enter a valid purchase unit and positive base-unit quantity.');
      return;
    }
    setError(null);
    onCommand({
      type: conversion.id ? 'conversion.update' : 'conversion.create',
      entityId: conversion.id,
      expectedVersion: conversion.expectedVersion,
      payload: {
        ...(conversion.id ? {} : {inventoryItemId: item.id}),
        purchaseUnitLabel: conversion.label.trim(), baseMicrosPerPurchaseUnit,
      },
    }, () => setConversion(null));
  }

  return (
    <section className="admin-card admin-form-grid" aria-label={item ? 'Edit inventory item' : 'Add inventory item'}>
      <div className="admin-inventory-list__header">
        <h2>{item ? 'Edit inventory item' : 'Add inventory item'}</h2>
        <button className="admin-secondary-button" type="button" disabled={pending} onClick={onClose}>Close</button>
      </div>
      <form className="admin-form-grid" onSubmit={submitItem}>
        <label>Item name
          <input value={name} required maxLength={160} disabled={pending} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <label>Base unit
          <input value={unitLabel} required maxLength={80} placeholder="g, kg, piece" disabled={pending} onChange={(event) => setUnitLabel(event.currentTarget.value)} />
        </label>
        <label>Tracking mode
          <select value={trackingMode} disabled={pending} onChange={(event) => setTrackingMode(event.currentTarget.value)}>
            <option value="RECIPE_TRACKED">Recipe tracked</option>
            <option value="BULK_MANUAL">Bulk / manual</option>
          </select>
        </label>
        {item ? <p className="admin-inventory-muted">After an item is used in recipes, purchasing or stock history, its base unit and tracking mode cannot be changed. Archive it and create a replacement instead.</p> : null}
        <label>Low-stock threshold (base units)
          <input value={threshold} inputMode="decimal" placeholder="Optional" disabled={pending} onChange={(event) => setThreshold(event.currentTarget.value)} />
        </label>
        <button className="admin-primary-button" type="submit" disabled={pending}>{item ? 'Save item' : 'Create inventory item'}</button>
      </form>
      {item ? (
        <>
          <button className="admin-secondary-button" type="button" disabled={pending}
            onClick={() => onCommand({
              type: item.active ? 'item.archive' : 'item.restore',
              entityId: item.id, expectedVersion: item.definitionVersion, payload: {},
            }, () => undefined)}>
            {item.active ? 'Archive inventory item' : 'Restore inventory item'}
          </button>
          <section className="admin-form-grid" aria-labelledby="inventory-purchase-units-title">
            <h3 id="inventory-purchase-units-title">Purchase units</h3>
            <p>Base unit: {item.unitLabel}. Conversion updates apply to future purchases only.</p>
            {(item.conversions ?? []).map((entry) => (
              <div className="admin-inventory-list__header" key={entry.id}>
                <div><strong>{entry.purchaseUnitLabel}</strong>
                  <small>1 {entry.purchaseUnitLabel} = {entry.baseMicrosPerPurchaseUnit / 1_000_000} {item.unitLabel} · {entry.active ? 'Active' : 'Archived'}</small>
                </div>
                <div className="admin-inventory-page-actions">
                  <button className="admin-secondary-button" type="button" disabled={pending} onClick={() => setConversion(conversionToDraft(entry))}>Edit</button>
                  <button className="admin-secondary-button" type="button" disabled={pending} onClick={() => onCommand({
                    type: entry.active ? 'conversion.archive' : 'conversion.restore',
                    entityId: entry.id, expectedVersion: entry.definitionVersion, payload: {},
                  }, () => undefined)}>{entry.active ? 'Archive' : 'Restore'}</button>
                </div>
              </div>
            ))}
            <button className="admin-secondary-button" type="button" disabled={pending || !item.active}
              onClick={() => setConversion({id: null,expectedVersion: null,label: '',baseQuantity: ''})}>
              Add purchase unit
            </button>
            {conversion ? <form className="admin-form-grid" onSubmit={submitConversion}>
              <label>Purchase unit label
                <input required maxLength={120} value={conversion.label} disabled={pending} onChange={(event) => setConversion((current) => current ? {...current,label: event.currentTarget.value} : current)} />
              </label>
              <label>Base units per purchase unit
                <input required inputMode="decimal" value={conversion.baseQuantity} disabled={pending} onChange={(event) => setConversion((current) => current ? {...current,baseQuantity: event.currentTarget.value} : current)} />
              </label>
              <button className="admin-primary-button" type="submit" disabled={pending}>Save purchase unit</button>
              <button className="admin-secondary-button" type="button" disabled={pending} onClick={() => setConversion(null)}>Cancel purchase unit</button>
            </form> : null}
          </section>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
