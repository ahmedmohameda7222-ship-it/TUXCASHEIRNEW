from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    p.write_text(text.replace(old, new, 1))


# 1) Persist immutable checkout charge components in the remote order projection.
replace_once(
    "packages/sync/src/remoteMaterializer.ts",
    """        items_subtotal_minor: order.itemsSubtotalMinor,
        discount_minor: order.discountMinor,
        total_minor: order.totalMinor,""",
    """        items_subtotal_minor: order.itemsSubtotalMinor,
        discount_minor: order.discountMinor,
        service_charge_minor: order.serviceChargeMinor ?? 0,
        tax_minor: order.taxMinor ?? 0,
        total_minor: order.totalMinor,""",
)

Path("supabase/migrations/20260910121500_admin_order_charge_sync_hardening.sql").write_text(
    """-- Preserve trusted checkout charge components in the remote Operations order projection.
-- Existing orders remain valid because both new components default to zero.

alter table public.orders
  add column if not exists service_charge_minor bigint not null default 0
    check (service_charge_minor >= 0);

alter table public.orders
  add column if not exists tax_minor bigint not null default 0
    check (tax_minor >= 0);

alter table public.orders
  drop constraint if exists orders_check1;

alter table public.orders
  drop constraint if exists orders_total_components_ck;

alter table public.orders
  add constraint orders_total_components_ck check (
    total_minor = items_subtotal_minor - discount_minor + final_delivery_fee_minor + service_charge_minor + tax_minor
  );
"""
)

sync_test = Path("packages/sync/src/remoteMaterializer.test.ts")
text = sync_test.read_text()
anchor = "  it('does not erase placement-only configuration version on later lifecycle updates', () => {"
if text.count(anchor) != 1:
    raise SystemExit("remoteMaterializer.test.ts anchor drift")
charged_test = """  it('materializes persisted service charge and tax components for charged orders', () => {
    const chargedOrder: OrderSnapshot = {
      ...order,
      serviceChargeMinor: moneyMinor(500),
      taxMinor: moneyMinor(1_470),
      totalMinor: moneyMinor(11_970),
      payments: order.payments.map((payment) => ({
        ...payment,
        allocatedMinor: moneyMinor(11_970),
        receivedMinor: moneyMinor(11_970),
        changeMinor: moneyMinor(0),
      })),
    };
    const event = outbox(
      'abababab-abab-4bab-8bab-abababababab',
      'ORDER_PLACED',
      operationsSyncPayloadJson({
        eventType: 'ORDER_PLACED',
        version: 1,
        order: chargedOrder,
        customerContactUpsert: null,
        inventoryMovements: [],
        configurationVersion: 42,
      }),
    );

    const plan = buildRemoteMaterializationPlanV1(toOperationsSyncEnvelopeV1(event));
    const orderMutation = plan.mutations.find((entry) => entry.table === 'orders');

    expect(orderMutation?.row).toMatchObject({
      service_charge_minor: 500,
      tax_minor: 1_470,
      total_minor: 11_970,
    });
  });

"""
sync_test.write_text(text.replace(anchor, charged_test + anchor, 1))

# 2) Carry and enforce published ONLINE weekly/special hours in Cairo time.
replace_once(
    "supabase/functions/order-intake/order-intake.ts",
    """export interface OnlineOrderPublishedCheckoutAuthority {
  shopId: string;""",
    """export interface OnlineOrderPublishedWeeklyHours {
  serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
  dayOfWeek: number;
  timezone: 'Africa/Cairo';
  opensLocal: string;
  closesLocal: string;
  active: boolean;
}

export interface OnlineOrderPublishedSpecialHours {
  serviceDate: string;
  serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
  timezone: 'Africa/Cairo';
  closed: boolean;
  opensLocal: string | null;
  closesLocal: string | null;
}

export interface OnlineOrderPublishedCheckoutAuthority {
  shopId: string;""",
)
replace_once(
    "supabase/functions/order-intake/order-intake.ts",
    """  requireCustomerPhone?: boolean;
  orderTypes: readonly OnlineOrderPublishedOrderType[];""",
    """  requireCustomerPhone?: boolean;
  weeklyHours?: readonly OnlineOrderPublishedWeeklyHours[];
  specialHours?: readonly OnlineOrderPublishedSpecialHours[];
  orderTypes: readonly OnlineOrderPublishedOrderType[];""",
)
replace_once(
    "supabase/functions/order-intake/published-checkout-authority.ts",
    """    onlineOrdersPaused: settings?.shopIdentity.onlineOrdersPaused ?? false,
    minimumOrderMinor:""",
    """    onlineOrdersPaused: settings?.shopIdentity.onlineOrdersPaused ?? false,
    weeklyHours: settings?.weeklyHours ?? [],
    specialHours: settings?.specialHours ?? [],
    minimumOrderMinor:""",
)

hours_logic = r"""const ONLINE_ORDERING_OUTSIDE_HOURS = 'online_ordering_outside_hours';
const ONLINE_ORDERING_TIMEZONE = 'Africa/Cairo';
const CAIRO_WEEKDAY: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface CairoLocalClock {
  serviceDate: string;
  dayOfWeek: number;
  minuteOfDay: number;
}

function cairoLocalClock(now: Date): CairoLocalClock {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: ONLINE_ORDERING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dayOfWeek = CAIRO_WEEKDAY[value('weekday')];
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (dayOfWeek === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('failed to resolve Africa/Cairo online-order clock');
  }
  return {
    serviceDate: `${value('year')}-${value('month')}-${value('day')}`,
    dayOfWeek,
    minuteOfDay: hour * 60 + minute,
  };
}

function adjacentServiceDate(serviceDate: string, deltaDays: number): string {
  const [year, month, day] = serviceDate.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  return `${value.getUTCFullYear().toString().padStart(4, '0')}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${value.getUTCDate().toString().padStart(2, '0')}`;
}

function localTimeMinute(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match) throw new Error('published online ordering hour is invalid');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('published online ordering hour is invalid');
  return hour * 60 + minute;
}

function startsOnServiceDate(opensLocal: string, closesLocal: string, minuteOfDay: number): boolean {
  const opens = localTimeMinute(opensLocal);
  const closes = localTimeMinute(closesLocal);
  return opens < closes
    ? minuteOfDay >= opens && minuteOfDay < closes
    : minuteOfDay >= opens;
}

function carriesIntoNextDate(opensLocal: string, closesLocal: string, minuteOfDay: number): boolean {
  const opens = localTimeMinute(opensLocal);
  const closes = localTimeMinute(closesLocal);
  return closes < opens && minuteOfDay < closes;
}

export function isPublishedOnlineOrderingOpenAt(
  authority: OnlineOrderPublishedCheckoutAuthority,
  now: Date,
): boolean {
  const weeklyHours = (authority.weeklyHours ?? []).filter(
    (hours) => hours.serviceKind === 'ONLINE' && hours.active,
  );
  const specialHours = (authority.specialHours ?? []).filter(
    (hours) => hours.serviceKind === 'ONLINE',
  );
  if (weeklyHours.length === 0 && specialHours.length === 0) return true;

  const clock = cairoLocalClock(now);
  const currentSpecial = specialHours.find((hours) => hours.serviceDate === clock.serviceDate);
  if (currentSpecial) {
    if (currentSpecial.closed || !currentSpecial.opensLocal || !currentSpecial.closesLocal) {
      return false;
    }
    return startsOnServiceDate(
      currentSpecial.opensLocal,
      currentSpecial.closesLocal,
      clock.minuteOfDay,
    );
  }

  const previousDate = adjacentServiceDate(clock.serviceDate, -1);
  const previousSpecial = specialHours.find((hours) => hours.serviceDate === previousDate);
  if (previousSpecial) {
    if (
      !previousSpecial.closed &&
      previousSpecial.opensLocal &&
      previousSpecial.closesLocal &&
      carriesIntoNextDate(previousSpecial.opensLocal, previousSpecial.closesLocal, clock.minuteOfDay)
    ) {
      return true;
    }
  } else {
    const previousDay = (clock.dayOfWeek + 6) % 7;
    if (
      weeklyHours.some(
        (hours) =>
          hours.dayOfWeek === previousDay &&
          carriesIntoNextDate(hours.opensLocal, hours.closesLocal, clock.minuteOfDay),
      )
    ) {
      return true;
    }
  }

  return weeklyHours.some(
    (hours) =>
      hours.dayOfWeek === clock.dayOfWeek &&
      startsOnServiceDate(hours.opensLocal, hours.closesLocal, clock.minuteOfDay),
  );
}

"""
intake = Path("supabase/functions/order-intake/order-intake.ts")
text = intake.read_text()
anchor = "function publishedCheckoutPolicyError(\n"
if text.count(anchor) != 1:
    raise SystemExit("order-intake.ts policy anchor drift")
text = text.replace(anchor, hours_logic + anchor, 1)
old_policy = """  if (authority.onlineOrdersPaused) return errorResponse(409, 'online_orders_paused');
  if (authority.requireCustomerPhone === true && normalizedPhone === null) {"""
new_policy = """  if (authority.onlineOrdersPaused) return errorResponse(409, 'online_orders_paused');
  if (!isPublishedOnlineOrderingOpenAt(authority, new Date())) {
    return errorResponse(409, ONLINE_ORDERING_OUTSIDE_HOURS);
  }
  if (authority.requireCustomerPhone === true && normalizedPhone === null) {"""
if text.count(old_policy) != 1:
    raise SystemExit("order-intake.ts policy body drift")
intake.write_text(text.replace(old_policy, new_policy, 1))

settings_test = Path("supabase/functions/order-intake/order-intakePublishedSettingsAuthority.test.ts")
text = settings_test.read_text()
replace_pairs = [
    (
        "import { describe, expect, it } from 'vitest';",
        "import { describe, expect, it, vi } from 'vitest';",
    ),
    (
        """  calculatePublishedCheckoutPricing,
  handleOrderIntakeRequest,""",
        """  calculatePublishedCheckoutPricing,
  handleOrderIntakeRequest,
  isPublishedOnlineOrderingOpenAt,""",
    ),
    (
        """  requireCustomerPhone: boolean;
  orderTypes:""",
        """  requireCustomerPhone: boolean;
  weeklyHours: ReadonlyArray<{
    serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
    dayOfWeek: number;
    timezone: 'Africa/Cairo';
    opensLocal: string;
    closesLocal: string;
    active: boolean;
  }>;
  specialHours: ReadonlyArray<{
    serviceDate: string;
    serviceKind: 'OPEN' | 'DELIVERY' | 'ONLINE';
    timezone: 'Africa/Cairo';
    closed: boolean;
    opensLocal: string | null;
    closesLocal: string | null;
  }>;
  orderTypes:""",
    ),
    (
        """    requireCustomerPhone: false,
    orderTypes:""",
        """    requireCustomerPhone: false,
    weeklyHours: [],
    specialHours: [],
    orderTypes:""",
    ),
]
for old, new in replace_pairs:
    if text.count(old) != 1:
        raise SystemExit(f"published settings test drift: {old[:40]}")
    text = text.replace(old, new, 1)
anchor = "  it('enforces the published minimum order against the server-computed trusted subtotal', async () => {"
if text.count(anchor) != 1:
    raise SystemExit("published settings test anchor drift")
hours_tests = """  it('enforces published ONLINE weekly hours before persistence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T10:30:00.000Z')); // Monday 12:30 in Cairo.
    try {
      const store = new MemoryStore(
        publishedAuthority({
          weeklyHours: [
            {
              serviceKind: 'ONLINE',
              dayOfWeek: 1,
              timezone: 'Africa/Cairo',
              opensLocal: '13:00',
              closesLocal: '14:00',
              active: true,
            },
          ],
        }),
      );

      const response = await handleOrderIntakeRequest(request(), store);

      expect(response.status).toBe(409);
      await expect(errorCode(response)).resolves.toBe('online_ordering_outside_hours');
      expect(store.inserted).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies Cairo weekly, overnight, and special ONLINE-hour authority deterministically', () => {
    const weekly = publishedAuthority({
      weeklyHours: [
        {
          serviceKind: 'ONLINE',
          dayOfWeek: 1,
          timezone: 'Africa/Cairo',
          opensLocal: '12:00',
          closesLocal: '13:00',
          active: true,
        },
        {
          serviceKind: 'ONLINE',
          dayOfWeek: 1,
          timezone: 'Africa/Cairo',
          opensLocal: '22:00',
          closesLocal: '02:00',
          active: true,
        },
      ],
    });
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T10:30:00.000Z'))).toBe(
      true,
    );
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T13:00:00.000Z'))).toBe(
      false,
    );
    expect(isPublishedOnlineOrderingOpenAt(weekly, new Date('2026-01-05T23:30:00.000Z'))).toBe(
      true,
    );

    const specialClosed = publishedAuthority({
      weeklyHours: weekly.weeklyHours,
      specialHours: [
        {
          serviceDate: '2026-01-05',
          serviceKind: 'ONLINE',
          timezone: 'Africa/Cairo',
          closed: true,
          opensLocal: null,
          closesLocal: null,
        },
      ],
    });
    expect(
      isPublishedOnlineOrderingOpenAt(specialClosed, new Date('2026-01-05T10:30:00.000Z')),
    ).toBe(false);
  });

"""
settings_test.write_text(text.replace(anchor, hours_tests + anchor, 1))

# 3) Make the new-product category explicit and selectable.
replace_once(
    "apps/admin/src/catalog/CatalogPage.tsx",
    "import { useMemo, useState } from 'react';",
    "import { useEffect, useMemo, useState } from 'react';",
)
replace_once(
    "apps/admin/src/catalog/CatalogPage.tsx",
    """  const [categoryId, setCategoryId] = useState('');
  const [selectedProductId,""",
    """  const [categoryId, setCategoryId] = useState('');
  const [newProductCategoryId, setNewProductCategoryId] = useState('');
  const [selectedProductId,""",
)
replace_once(
    "apps/admin/src/catalog/CatalogPage.tsx",
    """  const firstActiveCategory = categories.find((category) => category.active) ?? categories[0];
  const selectedProduct = useMemo(() => {""",
    """  const activeCategories = categories.filter((category) => category.active);
  const firstActiveCategory = activeCategories[0];

  useEffect(() => {
    if (activeCategories.some((category) => category.id === newProductCategoryId)) return;
    setNewProductCategoryId(firstActiveCategory?.id ?? '');
  }, [activeCategories, firstActiveCategory?.id, newProductCategoryId]);

  const selectedProduct = useMemo(() => {""",
)
replace_once(
    "apps/admin/src/catalog/CatalogPage.tsx",
    """    if (!shopId || !firstActiveCategory || !canEdit || !canPrice) return;
    const product = newProductForShop(shopId, firstActiveCategory.id, catalog.products);""",
    """    if (!shopId || !newProductCategoryId || !canEdit || !canPrice) return;
    const product = newProductForShop(shopId, newProductCategoryId, catalog.products);""",
)
replace_once(
    "apps/admin/src/catalog/CatalogPage.tsx",
    """      primaryAction={
        <button
          className="admin-primary-button"
          type="button"
          disabled={!canEdit || !canPrice || !firstActiveCategory || busy}
          title={!canPrice ? 'Creating a product requires catalog.pricing access.' : undefined}
          onClick={startNewProduct}
        >
          New product
        </button>
      }""",
    """      primaryAction={
        <div className="admin-catalog-new-product-controls">
          <label>
            <span>New product category</span>
            <select
              aria-label="New product category"
              value={newProductCategoryId}
              disabled={!canEdit || !canPrice || activeCategories.length === 0 || busy}
              onChange={(event) => setNewProductCategoryId(event.target.value)}
            >
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="admin-primary-button"
            type="button"
            disabled={!canEdit || !canPrice || !newProductCategoryId || busy}
            title={!canPrice ? 'Creating a product requires catalog.pricing access.' : undefined}
            onClick={startNewProduct}
          >
            New product
          </button>
        </div>
      }""",
)

regression = Path("apps/admin/src/catalog/finalReviewRound2Regressions.source.test.ts")
text = regression.read_text()
old = "expect(catalogPage).toMatch(/categoryId:\\s*newProductCategoryId/);"
new = "expect(catalogPage).toMatch(/newProductForShop\\(shopId,\\s*newProductCategoryId/);"
if text.count(old) != 1:
    raise SystemExit("round2 regression category assertion drift")
regression.write_text(text.replace(old, new, 1))
