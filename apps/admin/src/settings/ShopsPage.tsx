import type {
  AdminSettingsWorkspace,
  ShopHoursServiceKind,
  SpecialHoursExpectedRow,
  WeeklyHoursExpectedRow,
} from '@tux/admin-contracts';
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

function canonicalExpectedTime(value: string): string {
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function WeeklyHoursRowEditor({
  hours,
  settingsVersion,
  onUpsert,
  busy,
}: {
  hours: AdminSettingsWorkspace['weeklyHours'][number];
  settingsVersion: number;
  onUpsert: ((draft: ShopWeeklyHoursUpdateDraft) => void | Promise<void>) | undefined;
  busy: boolean;
}) {
  const [expectedSettingsVersion] = useState(settingsVersion);
  const [expectedRow, setExpectedRow] = useState<WeeklyHoursExpectedRow>(() => ({
    serviceKind: hours.serviceKind,
    dayOfWeek: hours.dayOfWeek,
    opensLocal: hours.opensLocal,
    closesLocal: hours.closesLocal,
    active: hours.active,
  }));
  const [form, setForm] = useState<WeeklyForm>(() => ({
    serviceKind: hours.serviceKind,
    dayOfWeek: hours.dayOfWeek,
    opensLocal: timeInput(hours.opensLocal),
    closesLocal: timeInput(hours.closesLocal),
    active: hours.active,
  }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpsert || busy) return;
    const nextRow: WeeklyHoursExpectedRow = {
      serviceKind: form.serviceKind,
      dayOfWeek: form.dayOfWeek,
      opensLocal: canonicalExpectedTime(form.opensLocal),
      closesLocal: canonicalExpectedTime(form.closesLocal),
      active: form.active,
    };
    await onUpsert({
      hoursId: hours.id,
      ...nextRow,
      expectedSettingsVersion,
      expectedRow,
    });
    setExpectedRow(nextRow);
  }

  return (
    <form
      className="admin-settings-row admin-settings-row--stack"
      onSubmit={(event) => void submit(event)}
    >
      <div className="admin-settings-grid">
        <select
          value={form.serviceKind}
          disabled={busy}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              serviceKind: event.currentTarget.value as ShopHoursServiceKind,
            }))
          }
        >
          <option value="OPEN">Open</option>
          <option value="DELIVERY">Delivery</option>
          <option value="ONLINE">Online</option>
        </select>
        <input
          type="number"
          min={0}
          max={6}
          value={form.dayOfWeek}
          disabled={busy}
          onChange={(event) =>
            setForm((current) => ({ ...current, dayOfWeek: Number(event.currentTarget.value) }))
          }
        />
        <input
          type="time"
          step={1}
          value={form.opensLocal}
          disabled={busy}
          onChange={(event) =>
            setForm((current) => ({ ...current, opensLocal: event.currentTarget.value }))
          }
        />
        <input
          type="time"
          step={1}
          value={form.closesLocal}
          disabled={busy}
          onChange={(event) =>
            setForm((current) => ({ ...current, closesLocal: event.currentTarget.value }))
          }
        />
        <label className="admin-check-field">
          <input
            type="checkbox"
            checked={form.active}
            disabled={busy}
            onChange={(event) =>
              setForm((current) => ({ ...current, active: event.currentTarget.checked }))
            }
          />
          <span>Active</span>
        </label>
      </div>
      <button className="admin-secondary-button" type="submit" disabled={busy || !onUpsert}>
        Save weekly hours
      </button>
    </form>
  );
}

function SpecialHoursRowEditor({
  hours,
  settingsVersion,
  onUpsert,
  busy,
}: {
  hours: AdminSettingsWorkspace['specialHours'][number];
  settingsVersion: number;
  onUpsert: ((draft: ShopSpecialHoursUpdateDraft) => void | Promise<void>) | undefined;
  busy: boolean;
}) {
  const [expectedSettingsVersion] = useState(settingsVersion);
  const [expectedRow, setExpectedRow] = useState<SpecialHoursExpectedRow>(() => ({
    serviceDate: hours.serviceDate,
    serviceKind: hours.serviceKind,
    closed: hours.closed,
    opensLocal: hours.opensLocal,
    closesLocal: hours.closesLocal,
    note: hours.note,
  }));
  const [serviceDate, setServiceDate] = useState(hours.serviceDate);
  const [serviceKind, setServiceKind] = useState(hours.serviceKind);
  const [closed, setClosed] = useState(hours.closed);
  const [opensLocal, setOpensLocal] = useState(timeInput(hours.opensLocal));
  const [closesLocal, setClosesLocal] = useState(timeInput(hours.closesLocal));
  const [note, setNote] = useState(hours.note ?? '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpsert || busy) return;
    const nextRow: SpecialHoursExpectedRow = {
      serviceDate,
      serviceKind,
      closed,
      opensLocal: closed ? null : canonicalExpectedTime(opensLocal),
      closesLocal: closed ? null : canonicalExpectedTime(closesLocal),
      note: note.trim() || null,
    };
    await onUpsert({
      hoursId: hours.id,
      ...nextRow,
      active: true,
      expectedSettingsVersion,
      expectedRow,
    });
    setExpectedRow(nextRow);
  }

  async function deactivate() {
    if (!onUpsert || busy) return;
    await onUpsert({
      hoursId: hours.id,
      ...expectedRow,
      active: false,
      expectedSettingsVersion,
      expectedRow,
    });
  }

  return (
    <form
      className="admin-settings-row admin-settings-row--stack"
      onSubmit={(event) => void submit(event)}
    >
      <div className="admin-settings-grid">
        <input
          type="date"
          value={serviceDate}
          disabled={busy}
          onChange={(event) => setServiceDate(event.currentTarget.value)}
        />
        <select
          value={serviceKind}
          disabled={busy}
          onChange={(event) => setServiceKind(event.currentTarget.value as ShopHoursServiceKind)}
        >
          <option value="OPEN">Open</option>
          <option value="DELIVERY">Delivery</option>
          <option value="ONLINE">Online</option>
        </select>
        <label className="admin-check-field">
          <input
            type="checkbox"
            checked={closed}
            disabled={busy}
            onChange={(event) => setClosed(event.currentTarget.checked)}
          />
          <span>Closed all day</span>
        </label>
        <input
          type="time"
          step={1}
          value={opensLocal}
          disabled={busy || closed}
          onChange={(event) => setOpensLocal(event.currentTarget.value)}
        />
        <input
          type="time"
          step={1}
          value={closesLocal}
          disabled={busy || closed}
          onChange={(event) => setClosesLocal(event.currentTarget.value)}
        />
        <input
          value={note}
          maxLength={500}
          disabled={busy}
          placeholder="Note"
          onChange={(event) => setNote(event.currentTarget.value)}
        />
      </div>
      <div className="admin-settings-row__main">
        <button className="admin-secondary-button" type="submit" disabled={busy || !onUpsert}>
          Save special hours
        </button>
        <button
          className="admin-secondary-button"
          type="button"
          disabled={busy || !onUpsert}
          onClick={() => void deactivate()}
        >
          Deactivate special override
        </button>
      </div>
    </form>
  );
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
    serviceKind: 'ONLINE',
    dayOfWeek: 0,
    opensLocal: '09:00',
    closesLocal: '22:00',
    active: true,
  });
  const [specialNew, setSpecialNew] = useState<SpecialForm>({
    serviceDate: '',
    serviceKind: 'ONLINE',
    closed: true,
    opensLocal: '',
    closesLocal: '',
    note: '',
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
            <input
              value={identity.name}
              maxLength={160}
              required
              disabled={busy}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, name: event.currentTarget.value }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Address</span>
            <input
              value={identity.address}
              maxLength={500}
              disabled={busy}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, address: event.currentTarget.value }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Contact phone</span>
            <input
              value={identity.contactPhone}
              maxLength={80}
              disabled={busy}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, contactPhone: event.currentTarget.value }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Latitude</span>
            <input
              type="number"
              min={-90}
              max={90}
              step="any"
              value={identity.latitude}
              disabled={busy}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, latitude: event.currentTarget.value }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Longitude</span>
            <input
              type="number"
              min={-180}
              max={180}
              step="any"
              value={identity.longitude}
              disabled={busy}
              onChange={(event) =>
                setIdentity((current) => ({ ...current, longitude: event.currentTarget.value }))
              }
            />
          </label>
        </div>
        <p className="admin-field__help">
          One canonical contact/location authority feeds Menu, delivery, receipts and store-location
          surfaces. Changes become live only after Publish settings.
        </p>
        <button className="admin-primary-button" type="submit" disabled={busy || !onUpdateIdentity}>
          Save shop identity
        </button>
      </form>

      <div className="admin-settings-grid">
        <article className="admin-settings-card">
          <span>Online orders</span>
          <strong>{shop.onlineOrdersPaused ? 'Paused' : 'Accepting orders'}</strong>
          <small>
            {shop.temporaryClosed
              ? 'Shop is temporarily closed.'
              : 'Shop is not temporarily closed.'}
          </small>
          <label className="admin-check-field">
            <input
              type="checkbox"
              checked={shop.temporaryClosed}
              disabled={operationalStateDisabled}
              onChange={(event) =>
                onUpdateOperationalState?.({
                  temporaryClosed: event.currentTarget.checked,
                  onlineOrdersPaused: shop.onlineOrdersPaused,
                  expectedSettingsVersion: workspace.settingsVersion,
                })
              }
            />
            <span>Temporarily close shop</span>
          </label>
          <label className="admin-check-field">
            <input
              type="checkbox"
              checked={shop.onlineOrdersPaused}
              disabled={operationalStateDisabled}
              onChange={(event) =>
                onUpdateOperationalState?.({
                  temporaryClosed: shop.temporaryClosed,
                  onlineOrdersPaused: event.currentTarget.checked,
                  expectedSettingsVersion: workspace.settingsVersion,
                })
              }
            />
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
            <WeeklyHoursRowEditor
              key={hours.id}
              hours={hours}
              settingsVersion={workspace.settingsVersion}
              onUpsert={onUpsertWeeklyHours}
              busy={busy}
            />
          ))}
        </div>
        <form className="admin-settings-card" onSubmit={(event) => void createWeekly(event)}>
          <strong>Add weekly window</strong>
          <div className="admin-settings-grid">
            <select
              value={weeklyNew.serviceKind}
              disabled={busy}
              onChange={(event) =>
                setWeeklyNew((current) => ({
                  ...current,
                  serviceKind: event.currentTarget.value as ShopHoursServiceKind,
                }))
              }
            >
              <option value="OPEN">Open</option>
              <option value="DELIVERY">Delivery</option>
              <option value="ONLINE">Online</option>
            </select>
            <input
              type="number"
              min={0}
              max={6}
              value={weeklyNew.dayOfWeek}
              disabled={busy}
              onChange={(event) =>
                setWeeklyNew((current) => ({
                  ...current,
                  dayOfWeek: Number(event.currentTarget.value),
                }))
              }
            />
            <input
              type="time"
              step={1}
              value={weeklyNew.opensLocal}
              disabled={busy}
              onChange={(event) =>
                setWeeklyNew((current) => ({ ...current, opensLocal: event.currentTarget.value }))
              }
            />
            <input
              type="time"
              step={1}
              value={weeklyNew.closesLocal}
              disabled={busy}
              onChange={(event) =>
                setWeeklyNew((current) => ({ ...current, closesLocal: event.currentTarget.value }))
              }
            />
          </div>
          <button
            className="admin-primary-button"
            type="submit"
            disabled={busy || !onUpsertWeeklyHours}
          >
            Save weekly hours
          </button>
        </form>
      </div>

      <div className="admin-settings-subsection">
        <h3>Special-date overrides</h3>
        <div className="admin-settings-list">
          {workspace.specialHours.map((hours) => (
            <SpecialHoursRowEditor
              key={hours.id}
              hours={hours}
              settingsVersion={workspace.settingsVersion}
              onUpsert={onUpsertSpecialHours}
              busy={busy}
            />
          ))}
        </div>
        <form className="admin-settings-card" onSubmit={(event) => void createSpecial(event)}>
          <strong>Add special-date override</strong>
          <div className="admin-settings-grid">
            <input
              type="date"
              required
              value={specialNew.serviceDate}
              disabled={busy}
              onChange={(event) =>
                setSpecialNew((current) => ({ ...current, serviceDate: event.currentTarget.value }))
              }
            />
            <select
              value={specialNew.serviceKind}
              disabled={busy}
              onChange={(event) =>
                setSpecialNew((current) => ({
                  ...current,
                  serviceKind: event.currentTarget.value as ShopHoursServiceKind,
                }))
              }
            >
              <option value="OPEN">Open</option>
              <option value="DELIVERY">Delivery</option>
              <option value="ONLINE">Online</option>
            </select>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={specialNew.closed}
                disabled={busy}
                onChange={(event) =>
                  setSpecialNew((current) => ({ ...current, closed: event.currentTarget.checked }))
                }
              />
              <span>Closed all day</span>
            </label>
            <input
              type="time"
              step={1}
              value={specialNew.opensLocal}
              disabled={busy || specialNew.closed}
              onChange={(event) =>
                setSpecialNew((current) => ({ ...current, opensLocal: event.currentTarget.value }))
              }
            />
            <input
              type="time"
              step={1}
              value={specialNew.closesLocal}
              disabled={busy || specialNew.closed}
              onChange={(event) =>
                setSpecialNew((current) => ({ ...current, closesLocal: event.currentTarget.value }))
              }
            />
            <input
              value={specialNew.note}
              maxLength={500}
              disabled={busy}
              placeholder="Note"
              onChange={(event) =>
                setSpecialNew((current) => ({ ...current, note: event.currentTarget.value }))
              }
            />
          </div>
          <button
            className="admin-primary-button"
            type="submit"
            disabled={busy || !onUpsertSpecialHours}
          >
            Save special hours
          </button>
        </form>
      </div>

      {onDeleteOrArchive ? (
        <div className="admin-settings-danger-zone">
          <div>
            <strong>Archive shop</strong>
            <span>Used shops are archived instead of deleting historical authority.</span>
          </div>
          <button
            className="admin-secondary-button"
            type="button"
            disabled={busy}
            onClick={onDeleteOrArchive}
          >
            Archive / delete unused shop
          </button>
        </div>
      ) : null}
    </section>
  );
}
