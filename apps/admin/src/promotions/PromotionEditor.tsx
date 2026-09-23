import type {
  AdminPromotion,
  AdminPromotionChannel,
  AdminPromotionKind,
  AdminPromotionStackingPolicy,
  AdminPromotionUpsertInput,
} from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

function csv(value: readonly string[]): string {
  return value.join(', ');
}

function list(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function PromotionEditor({
  shopId,
  promotion,
  saving,
  onCancel,
  onSave,
}: {
  shopId: string;
  promotion: AdminPromotion | null;
  saving: boolean;
  onCancel(): void;
  onSave(input: AdminPromotionUpsertInput): void;
}) {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [kind, setKind] = useState<AdminPromotionKind>('PERCENT');
  const [value, setValue] = useState('');
  const [freeProductId, setFreeProductId] = useState('');
  const [minimumOrderMinor, setMinimumOrderMinor] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [channel, setChannel] = useState<AdminPromotionChannel>('BOTH');
  const [productIds, setProductIds] = useState('');
  const [categoryIds, setCategoryIds] = useState('');
  const [totalUsageLimit, setTotalUsageLimit] = useState('');
  const [perCustomerUsageLimit, setPerCustomerUsageLimit] = useState('');
  const [stackingPolicy, setStackingPolicy] =
    useState<AdminPromotionStackingPolicy>('ONE_ORDER_LEVEL');

  useEffect(() => {
    setName(promotion?.name ?? '');
    setActive(promotion?.active ?? true);
    setKind(promotion?.kind ?? 'PERCENT');
    setValue(
      promotion?.kind === 'PERCENT'
        ? String(promotion.percentBasisPoints ?? '')
        : promotion?.kind === 'FIXED'
          ? String(promotion.fixedDiscountMinor ?? '')
          : '',
    );
    setFreeProductId(promotion?.freeProductId ?? '');
    setMinimumOrderMinor(String(promotion?.minimumOrderMinor ?? 0));
    setStartsAt(promotion?.startsAt ?? '');
    setEndsAt(promotion?.endsAt ?? '');
    setChannel(promotion?.channel ?? 'BOTH');
    setProductIds(csv(promotion?.productIds ?? []));
    setCategoryIds(csv(promotion?.categoryIds ?? []));
    setTotalUsageLimit(
      promotion?.totalUsageLimit === null || promotion?.totalUsageLimit === undefined
        ? ''
        : String(promotion.totalUsageLimit),
    );
    setPerCustomerUsageLimit(
      promotion?.perCustomerUsageLimit === null || promotion?.perCustomerUsageLimit === undefined
        ? ''
        : String(promotion.perCustomerUsageLimit),
    );
    setStackingPolicy(promotion?.stackingPolicy ?? 'ONE_ORDER_LEVEL');
  }, [promotion]);

  function optionalInteger(raw: string): number | null {
    if (!raw.trim()) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericValue = optionalInteger(value);
    const minimum = optionalInteger(minimumOrderMinor) ?? 0;
    onSave({
      id: promotion?.id ?? null,
      expectedVersion: promotion?.version ?? null,
      name: name.trim(),
      active,
      kind,
      percentBasisPoints: kind === 'PERCENT' ? numericValue : null,
      fixedDiscountMinor: kind === 'FIXED' ? numericValue : null,
      freeProductId: kind === 'FREE_ITEM' ? freeProductId.trim() || null : null,
      startsAt: startsAt.trim() || null,
      endsAt: endsAt.trim() || null,
      minimumOrderMinor: minimum,
      shopIds: [shopId],
      channel,
      productIds: list(productIds),
      categoryIds: list(categoryIds),
      totalUsageLimit: optionalInteger(totalUsageLimit),
      perCustomerUsageLimit: optionalInteger(perCustomerUsageLimit),
      stackingPolicy,
    });
  }

  return (
    <form onSubmit={submit} aria-label="Promotion editor">
      <h3>{promotion ? 'Edit promotion' : 'New promotion'}</h3>
      <label className="admin-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="admin-field">
        <span>Type</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as AdminPromotionKind)}>
          <option value="PERCENT">PERCENT</option>
          <option value="FIXED">FIXED</option>
          <option value="FREE_ITEM">FREE_ITEM</option>
        </select>
      </label>
      {kind === 'FREE_ITEM' ? (
        <label className="admin-field">
          <span>Free product ID</span>
          <input value={freeProductId} onChange={(event) => setFreeProductId(event.target.value)} />
        </label>
      ) : (
        <label className="admin-field">
          <span>{kind === 'PERCENT' ? 'Percent basis points' : 'Fixed discount minor'}</span>
          <input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
      )}
      <label className="admin-field">
        <span>Minimum order</span>
        <input
          inputMode="numeric"
          value={minimumOrderMinor}
          onChange={(event) => setMinimumOrderMinor(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Start</span>
        <input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
      </label>
      <label className="admin-field">
        <span>End</span>
        <input value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
      </label>
      <label className="admin-field">
        <span>Channel</span>
        <select
          value={channel}
          onChange={(event) => setChannel(event.target.value as AdminPromotionChannel)}
        >
          <option value="BOTH">BOTH</option>
          <option value="POS">POS</option>
          <option value="ONLINE">ONLINE</option>
        </select>
      </label>
      <label className="admin-field">
        <span>Product restrictions</span>
        <input value={productIds} onChange={(event) => setProductIds(event.target.value)} />
      </label>
      <label className="admin-field">
        <span>Category restrictions</span>
        <input value={categoryIds} onChange={(event) => setCategoryIds(event.target.value)} />
      </label>
      <label className="admin-field">
        <span>Total usage limit</span>
        <input
          inputMode="numeric"
          value={totalUsageLimit}
          onChange={(event) => setTotalUsageLimit(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Per-customer usage limit</span>
        <input
          inputMode="numeric"
          value={perCustomerUsageLimit}
          onChange={(event) => setPerCustomerUsageLimit(event.target.value)}
        />
      </label>
      <label className="admin-field">
        <span>Stacking policy</span>
        <select
          value={stackingPolicy}
          onChange={(event) =>
            setStackingPolicy(event.target.value as AdminPromotionStackingPolicy)
          }
        >
          <option value="ONE_ORDER_LEVEL">ONE_ORDER_LEVEL</option>
          <option value="ALLOW_CONFIGURED">ALLOW_CONFIGURED</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Active
      </label>
      <div>
        <button className="admin-primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save promotion'}
        </button>
        <button className="admin-secondary-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
