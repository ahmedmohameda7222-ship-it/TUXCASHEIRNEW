import type {
  AdminPromotion,
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
  return value ? value.slice(0, 16) : '';
}

function optionalPositiveInteger(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
  onCancel,
  onSave,
}: {
  shopId: string;
  promotion: AdminPromotion | null;
  products: readonly NamedOption[];
  categories: readonly NamedOption[];
  saving: boolean;
  onCancel(): void;
  onSave(input: AdminPromotionUpsertInput): void;
}) {
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [kind, setKind] = useState<AdminPromotionKind>('PERCENT');
  const [discount, setDiscount] = useState('');
  const [freeProductId, setFreeProductId] = useState('');
  const [minimumOrderEgp, setMinimumOrderEgp] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [channel, setChannel] = useState<AdminPromotionChannel>('BOTH');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('all');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [totalUsageLimit, setTotalUsageLimit] = useState('');
  const [perCustomerUsageLimit, setPerCustomerUsageLimit] = useState('');
  const [stackingPolicy, setStackingPolicy] =
    useState<AdminPromotionStackingPolicy>('ONE_ORDER_LEVEL');

  useEffect(() => {
    setName(promotion?.name ?? '');
    setActive(promotion?.active ?? true);
    setKind(promotion?.kind ?? 'PERCENT');
    setDiscount(
      promotion?.kind === 'PERCENT'
        ? String((promotion.percentBasisPoints ?? 0) / 100)
        : promotion?.kind === 'FIXED'
          ? String((promotion.fixedDiscountMinor ?? 0) / 100)
          : '',
    );
    setFreeProductId(promotion?.freeProductId ?? '');
    setMinimumOrderEgp(String((promotion?.minimumOrderMinor ?? 0) / 100));
    setStartsAt(dateTimeInput(promotion?.startsAt));
    setEndsAt(dateTimeInput(promotion?.endsAt));
    setChannel(promotion?.channel ?? 'BOTH');
    setProductIds([...(promotion?.productIds ?? [])]);
    setCategoryIds([...(promotion?.categoryIds ?? [])]);
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
    const numericDiscount = Number(discount);
    onSave({
      id: promotion?.id ?? null,
      expectedVersion: promotion?.version ?? null,
      name: name.trim(),
      active,
      kind,
      percentBasisPoints: kind === 'PERCENT' ? Math.round(numericDiscount * 100) : null,
      fixedDiscountMinor: kind === 'FIXED' ? Math.round(numericDiscount * 100) : null,
      freeProductId: kind === 'FREE_ITEM' ? freeProductId || null : null,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      minimumOrderMinor: Math.round(Number(minimumOrderEgp) * 100),
      shopIds: promotion?.shopIds ?? [shopId],
      channel,
      productIds: appliesTo === 'products' ? productIds : [],
      categoryIds: appliesTo === 'categories' ? categoryIds : [],
      totalUsageLimit: optionalPositiveInteger(totalUsageLimit),
      perCustomerUsageLimit: optionalPositiveInteger(perCustomerUsageLimit),
      stackingPolicy,
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
