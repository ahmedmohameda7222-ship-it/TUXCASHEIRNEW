import { AUTOMATIC_CUSTOMER_SEGMENTS } from '@tux/admin-contracts';
import type {
  AdminPromotion,
  AdminCustomerSegment,
  AdminPromotionChannel,
  AdminPromotionKind,
  AdminPromotionStackingPolicy,
  AdminPromotionUpsertInput,
} from '@tux/admin-contracts';
import { useEffect, useState, type FormEvent } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';

type NamedOption = { id: string; name: string };
type AppliesTo = 'all' | 'products' | 'categories';

function dateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function optionalPositiveInteger(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}${whole}.${fraction}`;
}

function parseDecimalMinor(raw: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const value = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function toggle(values: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...values, id])] : values.filter((value) => value !== id);
}

export function PromotionEditor({
  shopId,
  promotion,
  products,
  categories,
  saving,
  error = false,
  onCancel,
  onSave,
}: {
  shopId: string;
  promotion: AdminPromotion | null;
  products: readonly NamedOption[];
  categories: readonly NamedOption[];
  saving: boolean;
  error?: boolean;
  onCancel(): void;
  onSave(input: AdminPromotionUpsertInput): void;
}) {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [kind, setKind] = useState<AdminPromotionKind>('PERCENT');
  const [discount, setDiscount] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [freeProductId, setFreeProductId] = useState('');
  const [minimumOrderEgp, setMinimumOrderEgp] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [channel, setChannel] = useState<AdminPromotionChannel>('BOTH');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('all');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [targetSegments, setTargetSegments] = useState<AdminCustomerSegment[]>([]);
  const [totalUsageLimit, setTotalUsageLimit] = useState('');
  const [perCustomerUsageLimit, setPerCustomerUsageLimit] = useState('');
  const [stackingPolicy, setStackingPolicy] =
    useState<AdminPromotionStackingPolicy>('ONE_ORDER_LEVEL');

  useEffect(() => {
    setValidationError(null);
    setName(promotion?.name ?? '');
    setActive(promotion?.active ?? true);
    setKind(promotion?.kind ?? 'PERCENT');
    setDiscount(
      promotion?.kind === 'PERCENT'
        ? formatMinor(promotion.percentBasisPoints ?? 0)
        : promotion?.kind === 'FIXED'
          ? formatMinor(promotion.fixedDiscountMinor ?? 0)
          : '',
    );
    setFreeProductId(promotion?.freeProductId ?? '');
    setMinimumOrderEgp(formatMinor(promotion?.minimumOrderMinor ?? 0));
    setStartsAt(dateTimeInput(promotion?.startsAt));
    setEndsAt(dateTimeInput(promotion?.endsAt));
    setChannel(promotion?.channel ?? 'BOTH');
    setProductIds([...(promotion?.productIds ?? [])]);
    setCategoryIds([...(promotion?.categoryIds ?? [])]);
    setTargetSegments([...(promotion?.targetSegments ?? [])]);
    setAppliesTo(
      promotion?.productIds.length
        ? 'products'
        : promotion?.categoryIds.length
          ? 'categories'
          : 'all',
    );
    setTotalUsageLimit(promotion?.totalUsageLimit ? String(promotion.totalUsageLimit) : '');
    setPerCustomerUsageLimit(
      promotion?.perCustomerUsageLimit ? String(promotion.perCustomerUsageLimit) : '',
    );
    setStackingPolicy(promotion?.stackingPolicy ?? 'ONE_ORDER_LEVEL');
  }, [promotion]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const amount = kind === 'FREE_ITEM' ? null : parseDecimalMinor(discount);
    const minimumMinor = parseDecimalMinor(minimumOrderEgp.trim() || '0');
    if (
      minimumMinor === null ||
      (kind !== 'FREE_ITEM' && amount === null) ||
      (kind === 'PERCENT' && (amount === null || amount <= 0 || amount > 10_000))
    ) {
      setValidationError('Enter valid amounts with at most two decimal places.');
      return;
    }
    onSave({
      id: promotion?.id ?? null,
      expectedVersion: promotion?.version ?? null,
      name: name.trim(),
      active,
      kind,
      percentBasisPoints: kind === 'PERCENT' ? amount : null,
      fixedDiscountMinor: kind === 'FIXED' ? amount : null,
      freeProductId: kind === 'FREE_ITEM' ? freeProductId || null : null,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      minimumOrderMinor: minimumMinor,
      shopIds: promotion?.shopIds ?? [shopId],
      channel,
      productIds: appliesTo === 'products' ? productIds : [],
      categoryIds: appliesTo === 'categories' ? categoryIds : [],
      totalUsageLimit: optionalPositiveInteger(totalUsageLimit),
      perCustomerUsageLimit: optionalPositiveInteger(perCustomerUsageLimit),
      stackingPolicy,
      targetSegments,
    });
  }

  return (
    <AdminDialog
      open
      variant="sheet"
      title={promotion ? 'Edit promotion' : 'New promotion'}
      description="Build the customer offer using business-facing rules and named catalog choices."
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <form onSubmit={submit} aria-label="Promotion editor">
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Type</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AdminPromotionKind)}
          >
            <option value="PERCENT">Percentage discount</option>
            <option value="FIXED">Fixed amount discount</option>
            <option value="FREE_ITEM">Free item</option>
          </select>
        </label>

        {kind === 'FREE_ITEM' ? (
          <label className="admin-field">
            <span>Free product</span>
            <select
              value={freeProductId}
              onChange={(event) => setFreeProductId(event.target.value)}
              required
            >
              <option value="">Choose a product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="admin-field">
            <span>{kind === 'PERCENT' ? 'Discount (%)' : 'Discount (EGP)'}</span>
            <input
              type="number"
              min="0"
              step={kind === 'PERCENT' ? '0.01' : '0.01'}
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              required
            />
          </label>
        )}

        <label className="admin-field">
          <span>Minimum order (EGP)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={minimumOrderEgp}
            onChange={(event) => setMinimumOrderEgp(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Starts</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Ends</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Channel</span>
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as AdminPromotionChannel)}
          >
            <option value="POS">In-store</option>
            <option value="ONLINE">Online</option>
            <option value="BOTH">Both</option>
          </select>
        </label>

        <label className="admin-field">
          <span>Applies to</span>
          <select
            value={appliesTo}
            onChange={(event) => setAppliesTo(event.target.value as AppliesTo)}
          >
            <option value="all">All products</option>
            <option value="products">Selected products</option>
            <option value="categories">Categories</option>
          </select>
        </label>
        {appliesTo === 'products' ? (
          <fieldset className="admin-choice-list">
            <legend>Products</legend>
            {products.map((product) => (
              <label key={product.id}>
                <input
                  type="checkbox"
                  checked={productIds.includes(product.id)}
                  onChange={(event) =>
                    setProductIds((current) => toggle(current, product.id, event.target.checked))
                  }
                />
                {product.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        {appliesTo === 'categories' ? (
          <fieldset className="admin-choice-list">
            <legend>Categories</legend>
            {categories.map((category) => (
              <label key={category.id}>
                <input
                  type="checkbox"
                  checked={categoryIds.includes(category.id)}
                  onChange={(event) =>
                    setCategoryIds((current) => toggle(current, category.id, event.target.checked))
                  }
                />
                {category.name}
              </label>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="admin-choice-list">
          <legend>Target customer segments</legend>
          <p className="admin-field-help">
            Select no segments to make the promotion available to all eligible customers. Restricted
            offers require a recognized customer during checkout.
          </p>
          {AUTOMATIC_CUSTOMER_SEGMENTS.map((segment) => (
            <label key={segment}>
              <input
                type="checkbox"
                checked={targetSegments.includes(segment)}
                onChange={(event) =>
                  setTargetSegments(
                    (current) =>
                      toggle(current, segment, event.target.checked) as AdminCustomerSegment[],
                  )
                }
              />
              {segment}
            </label>
          ))}
        </fieldset>
        <label className="admin-field">
          <span>Total uses (optional)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={totalUsageLimit}
            onChange={(event) => setTotalUsageLimit(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Uses per customer (optional)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={perCustomerUsageLimit}
            onChange={(event) => setPerCustomerUsageLimit(event.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Can combine with other promotions?</span>
          <select
            value={stackingPolicy}
            onChange={(event) =>
              setStackingPolicy(event.target.value as AdminPromotionStackingPolicy)
            }
          >
            <option value="ONE_ORDER_LEVEL">No, use one order promotion</option>
            <option value="ALLOW_CONFIGURED">Yes, when the other promotion allows it</option>
          </select>
        </label>
        <p className="admin-field-help">
          Combining promotions is still checked by the trusted checkout rules.
        </p>
        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />{' '}
          Active
        </label>
        {validationError ? <p role="alert">{validationError}</p> : null}
        {error ? <p role="alert">Promotion could not be saved.</p> : null}
        <div className="admin-dialog__actions">
          <button className="admin-secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="admin-primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save promotion'}
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
