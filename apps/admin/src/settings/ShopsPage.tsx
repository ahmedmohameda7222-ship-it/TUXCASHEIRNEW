import type { AdminSettingsWorkspace, ShopHoursServiceKind } from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import type {
  ShopIdentityUpdateDraft,
  ShopSpecialHoursUpdateDraft,
  ShopWeeklyHoursUpdateDraft,
} from './useSettings';

type OperationalStateUpdate = {
  temporaryClosed: boolean;
  onlineOrdersPaused: boolean;
  expectedSettingsVersion: number;
};

type IdentityForm = {
  name: string;
  address: string;
  contactPhone: string;
  latitude: string;
  longitude: string;
};

type WeeklyForm = {
  serviceKind: ShopHoursServiceKind;
  dayOfWeek: number;
  opensLocal: string;
  closesLocal: string;
  active: boolean;
};

type SpecialForm = {
  serviceDate: string;
  serviceKind: ShopHoursServiceKind;
  closed: boolean;
  opensLocal: string;
  closesLocal: string;
  note: string;
};

function timeInput(value: string | null): string {
  return value ? value.slice(0, 8) : '';
}

export function ShopsPage({
  workspace,
  onUpdateOperationalState,
  onUpdateIdentity,
  onUpsertWeeklyHours,
  onUpsertSpecialHours,
  onDeleteOrArchive,
  busy = false,
}: {
  workspace: AdminSettingsWorkspace;
  onUpdateOperationalState?: (state: OperationalStateUpdate) => void;
  onUpdateIdentity?: (draft: ShopIdentityUpdateDraft) => void | Promise<void>;
  onUpsertWeeklyHours?: (draft: ShopWeeklyHoursUpdateDraft) => void | Promise<void>;
  onUpsertSpecialHours?: (draft: ShopSpecialHoursUpdateDraft) => void | Promise<void>;
  onDeleteOrArchive?: () => void;
  busy?: boolean;
}) {
  const shop = workspace.shop;
  const [identity, setIdentity] = useState<IdentityForm>({
    name: shop.name,
    address: shop.address ?? '',
    contactPhone: shop.contactPhone ?? '',
    latitude: shop.latitude?.toString() ?? '',
    longitude: shop.longitude?.toString() ?? '',
  });
  const [weeklyNew, setWeeklyNew] = useState<WeeklyForm>({
    serviceKind: 'ONLINE', dayOfWeek: 0, opensLocal: '09:00', closesLocal: '22:00', active: true,
  });
  const [specialNew, setSpecialNew] = useState<SpecialForm>({
    serviceDate: '', serviceKind: 'ONLINE', closed: true, opensLocal: '', closesLocal: '', note: '',
  });

  useEffect(() => {
    setIdentity({
      name: shop.name,
      address: shop.address ?? '',
      contactPhone: shop.contactPhone ?? '',
      latitude: shop.latitude?.toString() ?? '',
      longitude: shop.longitude?.toString() ?? '',
    });
  }, [shop.address, shop.contactPhone, shop.latitude, shop.longitude, shop.name]);

  const operationalStateDisabled = busy || !onUpdateOperationalState;

  async function saveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpdateIdentity || busy) return;
    const latitude = identity.latitude.trim() === '' ? null : Number(identity.latitude);
    const longitude = identity.longitude.trim() === '' ? null : Number(identity.longitude);
    if ((latitude === null) !== (longitude === null)) return;
    await onUpdateIdentity({
      name: identity.name.trim(),
      address: identity.address.trim() || null,
      contactPhone: identity.contactPhone.trim() || null,
      latitude,
      longitude,
      expectedSettingsVersion: workspace.settingsVersion,
      expectedIdentity: {
        name: shop.name,
        address: shop.address,
        contactPhone: shop.contactPhone,
        latitude: shop.latitude,
        longitude: shop.longitude,
      },
    });
  }

  async function createWeekly(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpsertWeeklyHours || busy) return;
    await onUpsertWeeklyHours({
      hoursId: null,
      ...weeklyNew,
      expectedSettingsVersion: workspace.settingsVersion,
      expectedRow: null,
    });
  }

  async function createSpecial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpsertSpecialHours || busy || !specialNew.serviceDate) return;
    await onUpsertSpecialHours({
      hoursId: null,
      serviceDate: specialNew.serviceDate,
      serviceKind: specialNew.serviceKind,
      closed: specialNew.closed,
      opensLocal: specialNew.closed ? null : specialNew.opensLocal,
      closesLocal: specialNew.closed ? null : specialNew.closesLocal,
      note: specialNew.note.trim() || null,
      active: true,
      expectedSettingsVersion: workspace.settingsVersion,
      expectedRow: null,
    });
  }

  return (
    <section className="admin-settings-section" aria-labelledby="settings-shop-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Canonical shop identity</p>
          <h2 id="settings-shop-title">{shop.name}</h2>
        </div>
        <span className="admin-status-pill">{shop.lifecycleState}</span>
      </div>

      <form className="admin-settings-card" onSubmit={(event) => void saveIdentity(event)}>
        <div className="admin-settings-grid">
          <label className="admin-field">
            <span>Display name</span>
            <input value={identity.name} maxLength={160} required disabled={busy} onChange={(event) => setIdentity((current) => ({ ...current, name: event.currentTarget.value }))} />
          </label>
          <label className="admin-field">
            <span>Address</span>
            <input value={identity.address} maxLength={500} disabled={busy} onChange={(event) => setIdentity((current) => ({ ...current, address: event.currentTarget.value }))} />
          </label>
          <label className="admin-field">
            <span>Contact phone</span>
            <input value={identity.contactPhone} maxLength={80} disabled={busy} onChange={(event) => setIdentity((current) => ({ ...current, contactPhone: event.currentTarget.value }))} />
          </label>
          <label className="admin-field">
            <span>Latitude</span>
            <input type="number" min={-90} max={90} step="any" value={identity.latitude} disabled={busy} onChange={(event) => setIdentity((current) => ({ ...current, latitude: event.currentTarget.value }))} />
          </label>
          <label className="admin-field">
            <span>Longitude</span>
            <input type="number" min={-180} max={180} step="any" value={identity.longitude} disabled={busy} onChange={(event) => setIdentity((current) => ({ ...current, longitude: event.currentTarget.value }))} />
          </label>
        </div>
        <p className="admin-field__help">One canonical contact/location authority feeds Menu, delivery, receipts and store-location surfaces. Changes become live only after Publish settings.</p>
        <button className="admin-primary-button" type="submit" disabled={busy || !onUpdateIdentity}>Save shop identity</button>
      </form>

      <div className="admin-settings-grid">
        <article className="admin-settings-card">
          <span>Online orders</span>
          <strong>{shop.onlineOrdersPaused ? 'Paused' : 'Accepting orders'}</strong>
          <small>{shop.temporaryClosed ? 'Shop is temporarily closed.' : 'Shop is not temporarily closed.'}</small>
          <label className="admin-check-field">
            <input type="checkbox" checked={shop.temporaryClosed} disabled={operationalStateDisabled} onChange={(event) => onUpdateOperationalState?.({ temporaryClosed: event.currentTarget.checked, onlineOrdersPaused: shop.onlineOrdersPaused, expectedSettingsVersion: workspace.settingsVersion })} />
            <span>Temporarily close shop</span>
          </label>
          <label className="admin-check-field">
            <input type="checkbox" checked={shop.onlineOrdersPaused} disabled={operationalStateDisabled} onChange={(event) => onUpdateOperationalState?.({ temporaryClosed: shop.temporaryClosed, onlineOrdersPaused: event.currentTarget.checked, expectedSettingsVersion: workspace.settingsVersion })} />
            <span>Pause online orders</span>
          </label>
          <small>These emergency controls publish immediately.</small>
        </article>
        <article className="admin-settings-card">
          <span>Timezone</span>
          <strong>{shop.timezone}</strong>
          <small>Service-hours wall-clock authority is fixed to Africa/Cairo.</small>
        </article>
      </div>

      <div className="admin-settings-subsection">
        <h3>Weekly service hours</h3>
        <div className="admin-settings-list">
          {workspace.weeklyHours.map((hours) => (
            <form
              className="admin-settings-row admin-settings-row--stack"
              key={hours.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void onUpsertWeeklyHours?.({
                  hoursId: hours.id,
                  serviceKind: String(form.get('serviceKind')) as ShopHoursServiceKind,
                  dayOfWeek: Number(form.get('dayOfWeek')),
                  opensLocal: String(form.get('opensLocal')),
                  closesLocal: String(form.get('closesLocal')),
                  active: form.get('active') === 'on',
                  expectedSettingsVersion: workspace.settingsVersion,
                  expectedRow: {
                    serviceKind: hours.serviceKind,
                    dayOfWeek: hours.dayOfWeek,
                    opensLocal: hours.opensLocal,
                    closesLocal: hours.closesLocal,
                    active: hours.active,
                  },
                });
              }}
            >
              <div className="admin-settings-grid">
                <select name="serviceKind" defaultValue={hours.serviceKind} disabled={busy}><option value="OPEN">Open</option><option value="DELIVERY">Delivery</option><option value="ONLINE">Online</option></select>
                <input name="dayOfWeek" type="number" min={0} max={6} defaultValue={hours.dayOfWeek} disabled={busy} />
                <input name="opensLocal" type="time" step={1} defaultValue={timeInput(hours.opensLocal)} disabled={busy} />
                <input name="closesLocal" type="time" step={1} defaultValue={timeInput(hours.closesLocal)} disabled={busy} />
                <label className="admin-check-field"><input name="active" type="checkbox" defaultChecked={hours.active} disabled={busy} /><span>Active</span></label>
              </div>
              <button className="admin-secondary-button" type="submit" disabled={busy || !onUpsertWeeklyHours}>Save weekly hours</button>
            </form>
          ))}
        </div>
        <form className="admin-settings-card" onSubmit={(event) => void createWeekly(event)}>
          <strong>Add weekly window</strong>
          <div className="admin-settings-grid">
            <select value={weeklyNew.serviceKind} disabled={busy} onChange={(event) => setWeeklyNew((current) => ({ ...current, serviceKind: event.currentTarget.value as ShopHoursServiceKind }))}><option value="OPEN">Open</option><option value="DELIVERY">Delivery</option><option value="ONLINE">Online</option></select>
            <input type="number" min={0} max={6} value={weeklyNew.dayOfWeek} disabled={busy} onChange={(event) => setWeeklyNew((current) => ({ ...current, dayOfWeek: Number(event.currentTarget.value) }))} />
            <input type="time" value={weeklyNew.opensLocal} disabled={busy} onChange={(event) => setWeeklyNew((current) => ({ ...current, opensLocal: event.currentTarget.value }))} />
            <input type="time" value={weeklyNew.closesLocal} disabled={busy} onChange={(event) => setWeeklyNew((current) => ({ ...current, closesLocal: event.currentTarget.value }))} />
          </div>
          <button className="admin-primary-button" type="submit" disabled={busy || !onUpsertWeeklyHours}>Save weekly hours</button>
        </form>
      </div>

      <div className="admin-settings-subsection">
        <h3>Special-date overrides</h3>
        <div className="admin-settings-list">
          {workspace.specialHours.map((hours) => (
            <form
              className="admin-settings-row admin-settings-row--stack"
              key={hours.id}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const closed = form.get('closed') === 'on';
                void onUpsertSpecialHours?.({
                  hoursId: hours.id,
                  serviceDate: String(form.get('serviceDate')),
                  serviceKind: String(form.get('serviceKind')) as ShopHoursServiceKind,
                  closed,
                  opensLocal: closed ? null : String(form.get('opensLocal')),
                  closesLocal: closed ? null : String(form.get('closesLocal')),
                  note: String(form.get('note') ?? '').trim() || null,
                  active: true,
                  expectedSettingsVersion: workspace.settingsVersion,
                  expectedRow: { serviceDate: hours.serviceDate, serviceKind: hours.serviceKind, closed: hours.closed, opensLocal: hours.opensLocal, closesLocal: hours.closesLocal, note: hours.note },
                });
              }}
            >
              <div className="admin-settings-grid">
                <input name="serviceDate" type="date" defaultValue={hours.serviceDate} disabled={busy} />
                <select name="serviceKind" defaultValue={hours.serviceKind} disabled={busy}><option value="OPEN">Open</option><option value="DELIVERY">Delivery</option><option value="ONLINE">Online</option></select>
                <label className="admin-check-field"><input name="closed" type="checkbox" defaultChecked={hours.closed} disabled={busy} /><span>Closed all day</span></label>
                <input name="opensLocal" type="time" step={1} defaultValue={timeInput(hours.opensLocal)} disabled={busy || hours.closed} />
                <input name="closesLocal" type="time" step={1} defaultValue={timeInput(hours.closesLocal)} disabled={busy || hours.closed} />
                <input name="note" defaultValue={hours.note ?? ''} maxLength={500} disabled={busy} placeholder="Note" />
              </div>
              <div className="admin-settings-row__main">
                <button className="admin-secondary-button" type="submit" disabled={busy || !onUpsertSpecialHours}>Save special hours</button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={busy || !onUpsertSpecialHours}
                  onClick={() => void onUpsertSpecialHours?.({
                    hoursId: hours.id,
                    serviceDate: hours.serviceDate,
                    serviceKind: hours.serviceKind,
                    closed: hours.closed,
                    opensLocal: hours.opensLocal,
                    closesLocal: hours.closesLocal,
                    note: hours.note,
                    active: false,
                    expectedSettingsVersion: workspace.settingsVersion,
                    expectedRow: { serviceDate: hours.serviceDate, serviceKind: hours.serviceKind, closed: hours.closed, opensLocal: hours.opensLocal, closesLocal: hours.closesLocal, note: hours.note },
                  })}
                >Deactivate special override</button>
              </div>
            </form>
          ))}
        </div>
        <form className="admin-settings-card" onSubmit={(event) => void createSpecial(event)}>
          <strong>Add special-date override</strong>
          <div className="admin-settings-grid">
            <input type="date" required value={specialNew.serviceDate} disabled={busy} onChange={(event) => setSpecialNew((current) => ({ ...current, serviceDate: event.currentTarget.value }))} />
            <select value={specialNew.serviceKind} disabled={busy} onChange={(event) => setSpecialNew((current) => ({ ...current, serviceKind: event.currentTarget.value as ShopHoursServiceKind }))}><option value="OPEN">Open</option><option value="DELIVERY">Delivery</option><option value="ONLINE">Online</option></select>
            <label className="admin-check-field"><input type="checkbox" checked={specialNew.closed} disabled={busy} onChange={(event) => setSpecialNew((current) => ({ ...current, closed: event.currentTarget.checked }))} /><span>Closed all day</span></label>
            <input type="time" value={specialNew.opensLocal} disabled={busy || specialNew.closed} onChange={(event) => setSpecialNew((current) => ({ ...current, opensLocal: event.currentTarget.value }))} />
            <input type="time" value={specialNew.closesLocal} disabled={busy || specialNew.closed} onChange={(event) => setSpecialNew((current) => ({ ...current, closesLocal: event.currentTarget.value }))} />
            <input value={specialNew.note} maxLength={500} disabled={busy} placeholder="Note" onChange={(event) => setSpecialNew((current) => ({ ...current, note: event.currentTarget.value }))} />
          </div>
          <button className="admin-primary-button" type="submit" disabled={busy || !onUpsertSpecialHours}>Save special hours</button>
        </form>
      </div>

      {onDeleteOrArchive ? (
        <div className="admin-settings-danger-zone">
          <div><strong>Archive shop</strong><span>Used shops are archived instead of deleting historical authority.</span></div>
          <button className="admin-secondary-button" type="button" disabled={busy} onClick={onDeleteOrArchive}>Archive / delete unused shop</button>
        </div>
      ) : null}
    </section>
  );
}