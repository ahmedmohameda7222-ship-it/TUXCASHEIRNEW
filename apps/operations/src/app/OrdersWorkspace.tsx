import type {
  OperationsSessionState,
  OrdersWorkspace as OrdersWorkspaceData,
} from '@tux/application';
import {
  ZERO_MONEY,
  addProductUnit,
  decrementDraftLine,
  decrementProductUnit,
  normalizeEgyptianPhone,
  parseEntityId,
  productQuantityInDraft,
  replaceDraftLineCustomization,
  validateOrderDraft,
  type DraftLineCustomization,
  type DraftLineId,
  type MenuCategoryId,
  type OrderDraft,
  type OrderId,
  type OrderValidationIssue,
  type Product,
  type ProductId,
} from '@tux/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MenuProductCard } from './MenuProductCard';
import type { OperationsOrdersClient } from './sessionClient';
import { OrdersCart, type DraftMutation } from './OrdersCart';
import { ProductCustomizer, type ProductCustomizerTarget } from './ProductCustomizer';
import { formatMoneyMinor, nextDraftAddedSequence, resolveOrdersDraftScopeId } from './ordersView';

type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;

interface UndoState {
  readonly snapshot: OrderDraft;
  readonly message: string;
}

interface PrintNoticeState {
  readonly orderId: OrderId;
  readonly displayOrderNo: number;
  readonly kind: 'FAILED' | 'UNKNOWN';
  readonly message: string;
}

function ProductImage({ product }: { readonly product: Product }) {
  const [failed, setFailed] = useState(false);
  if (product.imageKey === null || failed) {
    return (
      <div className="product-image-fallback" aria-hidden="true">
        {product.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.slice(0, 1).toUpperCase())
          .join('')}
      </div>
    );
  }
  return (
    <img
      className="product-image"
      src={product.imageKey}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function restoreDraftContents(current: OrderDraft, snapshot: OrderDraft): OrderDraft {
  return {
    ...current,
    orderTypeId: snapshot.orderTypeId,
    lines: snapshot.lines,
    orderNote: snapshot.orderNote,
    discountMinor: snapshot.discountMinor,
    delivery: snapshot.delivery,
    payment: snapshot.payment,
  };
}

function QuickInfo({
  product,
  canCustomize,
  busy,
  onClose,
  onCustomize,
}: {
  readonly product: Product;
  readonly canCustomize: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCustomize: () => void;
}) {
  return (
    <div
      className="orders-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="quick-info"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-info-title"
      >
        <div className="quick-info-media">
          <ProductImage product={product} />
        </div>
        <div className="quick-info-body">
          <span className="drawer-kicker">Quick Info</span>
          <h2 id="quick-info-title">{product.name}</h2>
          <strong>{formatMoneyMinor(product.priceMinor)}</strong>
          <p>{product.description?.trim() || 'No product description has been added yet.'}</p>
          {product.soldOut ? <span className="sold-out-label">Sold Out</span> : null}
        </div>
        <div className="drawer-footer">
          <button type="button" className="secondary-action" disabled={busy} onClick={onClose}>
            Close
          </button>
          {canCustomize && !product.soldOut ? (
            <button type="button" className="primary-action" disabled={busy} onClick={onCustomize}>
              Customize & add
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function OrdersWorkspace({
  session,
  client,
}: {
  readonly session: ActiveSession;
  readonly client: OperationsOrdersClient;
}) {
  const draftScopeId = useMemo(resolveOrdersDraftScopeId, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<OrderDraft | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const undoTimerRef = useRef<number | null>(null);

  const [workspace, setWorkspace] = useState<OrdersWorkspaceData | null>(null);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [printNotice, setPrintNotice] = useState<PrintNoticeState | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<MenuCategoryId | null>(null);
  const [selectedProductFamily, setSelectedProductFamily] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customizer, setCustomizer] = useState<ProductCustomizerTarget | null>(null);
  const [quickInfoProductId, setQuickInfoProductId] = useState<ProductId | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  function setCurrentDraft(next: OrderDraft): void {
    draftRef.current = next;
    setDraft(next);
    setWorkspace((current) => (current === null ? null : { ...current, draft: next }));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGlobalError(null);
    void client.loadWorkspace(draftScopeId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setGlobalError(result.error.message);
        return;
      }
      setWorkspace(result.value);
      if (result.value.recoveryState === 'PREVIOUS_ORDER_ALREADY_SAVED') {
        setSuccessMessage('Previous order was already saved. A new cart is ready.');
      }
      draftRef.current = result.value.draft;
      setDraft(result.value.draft);
      const categories = result.value.configuration.categories
        .filter((category) => category.active)
        .sort((left, right) => left.sortOrder - right.sortOrder);
      setSelectedCategoryId((current) =>
        current !== null && categories.some((category) => category.id === current)
          ? current
          : (categories[0]?.id ?? null),
      );
      setSelectedProductFamily(null);
    });
    return () => {
      cancelled = true;
    };
  }, [client, draftScopeId, session.businessDayId, session.operator.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const targetIsEditor =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === '/' && !targetIsEditor) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && search.length > 0) {
        event.preventDefault();
        setSearch('');
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [search]);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  function beginPendingSave(): void {
    pendingSaveCountRef.current += 1;
    setSaving(true);
  }

  function endPendingSave(): void {
    pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
    if (pendingSaveCountRef.current === 0) setSaving(false);
  }

  function enqueueMutation(mutation: DraftMutation): void {
    beginPendingSave();
    const run = saveQueueRef.current.then(async () => {
      const current = draftRef.current;
      if (current === null) return;
      let proposed: OrderDraft;
      try {
        proposed = mutation(current);
      } catch (error) {
        setGlobalError(
          error instanceof Error ? error.message : 'Could not update the order draft.',
        );
        return;
      }
      if (proposed === current) return;
      setCurrentDraft(proposed);
      const result = await client.saveDraft(proposed);
      if (!result.ok) {
        setCurrentDraft(current);
        setGlobalError(result.error.message);
        return;
      }
      setCurrentDraft(result.value);
      setGlobalError(null);
    });
    saveQueueRef.current = run
      .catch((error: unknown) => {
        setGlobalError(error instanceof Error ? error.message : 'Could not save the order draft.');
      })
      .finally(endPendingSave);
  }

  function showUndo(snapshot: OrderDraft, message: string): void {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    setUndo({ snapshot, message });
    undoTimerRef.current = window.setTimeout(() => {
      setUndo(null);
      undoTimerRef.current = null;
    }, 7_000);
  }

  function undoLastDraftChange(): void {
    const currentUndo = undo;
    if (currentUndo === null) return;
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndo(null);
    enqueueMutation((current) => restoreDraftContents(current, currentUndo.snapshot));
  }

  const configuration = workspace?.configuration ?? null;
  const activeCategories = useMemo(
    () =>
      configuration?.categories
        .filter((category) => category.active)
        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],
    [configuration],
  );
  const productFamilies = useMemo(() => {
    if (configuration === null || selectedCategoryId === null) return [];
    const seen = new Set<string>();
    const families: string[] = [];
    const categoryProducts = configuration.products
      .filter((product) => product.active && product.categoryId === selectedCategoryId)
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder);
    for (const product of categoryProducts) {
      const family = product.family?.trim();
      if (!family || seen.has(family)) continue;
      seen.add(family);
      families.push(family);
    }
    return families;
  }, [configuration, selectedCategoryId]);

  useEffect(() => {
    if (selectedProductFamily !== null && !productFamilies.includes(selectedProductFamily)) {
      setSelectedProductFamily(null);
    }
  }, [productFamilies, selectedProductFamily]);

  const products = useMemo(() => {
    if (configuration === null) return [];
    const active = configuration.products.filter((product) => product.active);
    const query = search.trim().toLocaleLowerCase();
    const filtered =
      query.length > 0
        ? active.filter((product) => product.name.toLocaleLowerCase().includes(query))
        : active.filter(
            (product) =>
              product.categoryId === selectedCategoryId &&
              (selectedProductFamily === null || product.family === selectedProductFamily),
          );
    return [...filtered].sort((left, right) => left.sortOrder - right.sortOrder);
  }, [configuration, search, selectedCategoryId, selectedProductFamily]);

  const validation = useMemo(() => {
    if (draft === null || configuration === null) return null;
    return validateOrderDraft(draft, configuration);
  }, [configuration, draft]);
  const visibleIssues: readonly OrderValidationIssue[] =
    showValidation && validation !== null && !validation.valid ? validation.issues : [];

  const totalQuantity = draft?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0;
  const quickInfoProduct =
    quickInfoProductId === null
      ? null
      : (configuration?.products.find((product) => product.id === quickInfoProductId) ?? null);

  function addProduct(product: Product): void {
    if (draftRef.current === null || configuration === null || product.soldOut) return;
    if (product.isCombo) {
      setCustomizer({ kind: 'ADD', productId: product.id });
      return;
    }
    enqueueMutation((current) =>
      addProductUnit({
        draft: current,
        configuration,
        productId: product.id,
        lineId: parseEntityId<DraftLineId>(crypto.randomUUID()),
        addedSequence: nextDraftAddedSequence(current),
      }),
    );
  }

  function decrementProduct(product: Product): void {
    const current = draftRef.current;
    if (current === null || productQuantityInDraft(current, product.id) === 0) return;
    showUndo(current, `Removed one ${product.name}`);
    enqueueMutation((candidate) => decrementProductUnit(candidate, product.id));
  }

  function decrementLine(lineId: DraftLineId): void {
    const current = draftRef.current;
    const line = current?.lines.find((candidate) => candidate.id === lineId);
    if (current === null || line === undefined) return;
    showUndo(current, `Removed one ${line.productName}`);
    enqueueMutation((candidate) => decrementDraftLine(candidate, lineId));
  }

  function submitCustomization(customization: DraftLineCustomization): void {
    if (customizer === null || configuration === null) return;
    if (customizer.kind === 'ADD') {
      const target = customizer;
      enqueueMutation((current) =>
        addProductUnit({
          draft: current,
          configuration,
          productId: target.productId,
          lineId: parseEntityId<DraftLineId>(crypto.randomUUID()),
          addedSequence: nextDraftAddedSequence(current),
          customization,
        }),
      );
    } else {
      const target = customizer;
      enqueueMutation((current) =>
        replaceDraftLineCustomization({
          draft: current,
          lineId: target.lineId,
          configuration,
          customization,
        }),
      );
    }
    setCustomizer(null);
    setQuickInfoProductId(null);
  }

  function confirmClear(): void {
    const current = draftRef.current;
    if (current === null) return;
    showUndo(current, 'Order cleared');
    enqueueMutation((candidate) => ({
      ...candidate,
      lines: [],
      orderNote: null,
      discountMinor: ZERO_MONEY,
      delivery: {
        ...candidate.delivery,
        displayPhone: '',
        normalizedPhone: '',
        customerName: '',
        address: '',
        zoneId: null,
        zoneLabel: '',
        configuredFeeMinor: ZERO_MONEY,
        finalFeeMinor: ZERO_MONEY,
      },
      payment: { mode: 'NONE' },
    }));
    setClearConfirmOpen(false);
    setShowValidation(false);
  }

  function commitDeliveryPhone(displayPhone: string): void {
    if (configuration === null || workspace === null) return;
    const normalized = normalizeEgyptianPhone(displayPhone);
    enqueueMutation((current) => ({
      ...current,
      delivery: {
        ...current.delivery,
        displayPhone,
        normalizedPhone: normalized.normalizedPhone,
      },
    }));
    if (!normalized.valid) return;

    const normalizedPhone = normalized.normalizedPhone;
    void saveQueueRef.current.then(async () => {
      const result = await client.findCustomerByPhone(workspace.shopId, normalizedPhone);
      if (!result.ok) {
        setGlobalError(result.error.message);
        return;
      }
      const contact = result.value;
      if (contact === null) return;
      enqueueMutation((current) => {
        if (current.delivery.normalizedPhone !== normalizedPhone) return current;
        const zone =
          contact.latestZoneId === null
            ? null
            : (configuration.deliveryZones.find(
                (candidate) => candidate.id === contact.latestZoneId && candidate.active,
              ) ?? null);
        const withContact: OrderDraft = {
          ...current,
          delivery: {
            ...current.delivery,
            customerName: contact.name,
            address: contact.latestAddress ?? current.delivery.address,
          },
        };
        return zone === null
          ? withContact
          : {
              ...withContact,
              delivery: {
                ...withContact.delivery,
                zoneId: zone.id,
                zoneLabel: zone.name,
                configuredFeeMinor: zone.feeMinor,
                finalFeeMinor: zone.feeMinor,
              },
            };
      });
    });
  }

  async function placeOrder(): Promise<void> {
    await saveQueueRef.current;
    const current = draftRef.current;
    if (current === null || configuration === null) return;
    const checked = validateOrderDraft(current, configuration);
    if (!checked.valid) {
      setShowValidation(true);
      setGlobalError(checked.issues[0]?.message ?? 'Check the order details.');
      return;
    }

    setPlacing(true);
    setGlobalError(null);
    const result = await client.placeOrder(current);
    setPlacing(false);
    if (!result.ok) {
      setShowValidation(true);
      setGlobalError(result.error.message);
      return;
    }

    setCurrentDraft(result.value.nextDraft);
    setShowValidation(false);
    setSearch('');
    setMobileCartOpen(false);
    setUndo(null);
    const prefix = result.value.replayed ? 'Recovered' : 'Placed';
    setSuccessMessage(`${prefix} order #${result.value.order.displayOrderNo}`);
    window.setTimeout(() => setSuccessMessage(null), 4_500);

    const printFailed = result.value.postCommitWarnings.includes('PRINT_FAILED');
    const printUnknown = result.value.postCommitWarnings.includes('PRINT_STATUS_UNKNOWN');
    if (printFailed || printUnknown) {
      setPrintNotice({
        orderId: result.value.order.id,
        displayOrderNo: result.value.order.displayOrderNo,
        kind: printFailed ? 'FAILED' : 'UNKNOWN',
        message: printFailed
          ? 'The order is saved locally, but the receipt did not print.'
          : 'The order was recovered safely. Receipt print status is unknown, so it was not printed again automatically.',
      });
    } else {
      setPrintNotice(null);
    }

    const otherWarnings = result.value.postCommitWarnings.filter(
      (warning) => warning !== 'PRINT_FAILED' && warning !== 'PRINT_STATUS_UNKNOWN',
    );
    if (otherWarnings.length > 0) {
      setGlobalError(
        `Order #${result.value.order.displayOrderNo} is saved locally. Follow-up issue: ${otherWarnings.join(', ')}`,
      );
    }
  }

  async function reprintReceipt(): Promise<void> {
    const notice = printNotice;
    if (notice === null || reprinting) return;

    setReprinting(true);
    const result = await client.reprintOrder(notice.orderId);
    setReprinting(false);
    if (!result.ok) {
      setPrintNotice({
        ...notice,
        kind: 'FAILED',
        message: `Order #${notice.displayOrderNo} is still saved locally. ${result.error.message}`,
      });
      return;
    }

    setPrintNotice(null);
    setSuccessMessage(`Receipt reprinted for order #${result.value.displayOrderNo}`);
    window.setTimeout(() => setSuccessMessage(null), 4_500);
  }

  if (loading) {
    return <main className="orders-loading" aria-label="Loading Orders" />;
  }
  if (workspace === null || draft === null || configuration === null) {
    return (
      <main className="orders-unavailable">
        <h1>Orders unavailable</h1>
        <p>{globalError ?? 'The local Orders workspace could not be loaded.'}</p>
      </main>
    );
  }

  const busy = saving || placing;

  return (
    <main className="orders-workspace">
      <section className="menu-pane" aria-label="Menu">
        <div className="menu-toolbar">
          <div className="field-stack">
            <div className="category-rail" aria-label="Menu categories">
              {activeCategories.map((category) => (
                <button
                  type="button"
                  key={category.id}
                  className={
                    selectedCategoryId === category.id && search.length === 0
                      ? 'selected'
                      : undefined
                  }
                  onClick={() => {
                    setSelectedCategoryId(category.id);
                    setSelectedProductFamily(null);
                    setSearch('');
                  }}
                >
                  {category.name}
                </button>
              ))}
            </div>
            {search.length === 0 && productFamilies.length > 1 ? (
              <div className="segmented-control" aria-label="Product families">
                <button
                  type="button"
                  className={selectedProductFamily === null ? 'selected' : undefined}
                  onClick={() => setSelectedProductFamily(null)}
                >
                  All
                </button>
                {productFamilies.map((family) => (
                  <button
                    type="button"
                    key={family}
                    className={selectedProductFamily === family ? 'selected' : undefined}
                    onClick={() => setSelectedProductFamily(family)}
                  >
                    {family}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="product-search">
            <label htmlFor="product-search">Search menu</label>
            <div>
              <input
                ref={searchRef}
                id="product-search"
                type="search"
                value={search}
                placeholder="Search products"
                autoComplete="off"
                onChange={(event) => {
                  const nextSearch = event.target.value;
                  setSearch(nextSearch);
                  if (nextSearch.trim().length > 0) setSelectedProductFamily(null);
                }}
              />
              <kbd>Ctrl K</kbd>
            </div>
          </div>
        </div>

        <div className="product-grid" aria-live="polite">
          {products.length === 0 ? (
            <div className="menu-empty">
              <strong>No products found</strong>
              <span>
                {search.length > 0
                  ? 'Try another search.'
                  : 'This category has no active products.'}
              </span>
            </div>
          ) : (
            products.map((product) => (
              <MenuProductCard
                key={product.id}
                product={product}
                quantity={productQuantityInDraft(draft, product.id)}
                busy={busy}
                onQuickInfo={() => setQuickInfoProductId(product.id)}
                onDecrement={() => decrementProduct(product)}
                onAdd={() => addProduct(product)}
              />
            ))
          )}
        </div>
      </section>

      <div className="desktop-cart-wrap">
        <OrdersCart
          draft={draft}
          configuration={configuration}
          issues={visibleIssues}
          busy={saving}
          placing={placing}
          onMutate={enqueueMutation}
          onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}
          onDecrementLine={decrementLine}
          onClear={() => setClearConfirmOpen(true)}
          onDeliveryPhoneCommit={commitDeliveryPhone}
          onPlace={() => void placeOrder()}
        />
      </div>

      <button
        type="button"
        className="mobile-cart-trigger"
        onClick={() => setMobileCartOpen(true)}
        disabled={draft.lines.length === 0}
      >
        <span>Order · {totalQuantity}</span>
        <strong>Review & pay</strong>
      </button>

      {mobileCartOpen ? (
        <div className="mobile-cart-overlay">
          <div className="mobile-cart-bar">
            <strong>Current order</strong>
            <button type="button" className="quiet-action" onClick={() => setMobileCartOpen(false)}>
              Close
            </button>
          </div>
          <OrdersCart
            draft={draft}
            configuration={configuration}
            issues={visibleIssues}
            busy={saving}
            placing={placing}
            onMutate={enqueueMutation}
            onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}
            onDecrementLine={decrementLine}
            onClear={() => setClearConfirmOpen(true)}
            onDeliveryPhoneCommit={commitDeliveryPhone}
            onPlace={() => void placeOrder()}
          />
        </div>
      ) : null}

      {customizer === null ? null : (
        <ProductCustomizer
          key={
            customizer.kind === 'ADD' ? `add:${customizer.productId}` : `edit:${customizer.lineId}`
          }
          target={customizer}
          draft={draft}
          configuration={configuration}
          busy={busy}
          onCancel={() => setCustomizer(null)}
          onSubmit={submitCustomization}
        />
      )}

      {quickInfoProduct === null ? null : (
        <QuickInfo
          product={quickInfoProduct}
          busy={busy}
          canCustomize={
            quickInfoProduct.isCombo ||
            configuration.productModifierLinks.some(
              (link) => link.productId === quickInfoProduct.id,
            )
          }
          onClose={() => setQuickInfoProductId(null)}
          onCustomize={() => {
            setQuickInfoProductId(null);
            setCustomizer({ kind: 'ADD', productId: quickInfoProduct.id });
          }}
        />
      )}

      {clearConfirmOpen ? (
        <div className="orders-overlay" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-title"
          >
            <h2 id="clear-title">Clear this order?</h2>
            <p>This only clears the current draft. No placed order is changed.</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => setClearConfirmOpen(false)}
              >
                Keep order
              </button>
              <button type="button" className="destructive-action" onClick={confirmClear}>
                Clear order
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {undo === null ? null : (
        <div className="undo-toast" role="status">
          <span>{undo.message}</span>
          <button type="button" onClick={undoLastDraftChange}>
            Undo
          </button>
        </div>
      )}
      {successMessage === null ? null : (
        <div className="success-toast" role="status">
          {successMessage}
        </div>
      )}
      {printNotice === null ? null : (
        <div className="print-notice" role="status">
          <div>
            <strong>Order #{printNotice.displayOrderNo} saved locally</strong>
            <span>{printNotice.message}</span>
          </div>
          <div className="print-notice-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={reprinting}
              onClick={() => void reprintReceipt()}
            >
              {reprinting
                ? 'Printing…'
                : printNotice.kind === 'FAILED'
                  ? 'Retry print'
                  : 'Reprint receipt'}
            </button>
            <button
              type="button"
              className="quiet-action"
              disabled={reprinting}
              onClick={() => setPrintNotice(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {globalError === null ? null : (
        <div className="global-error orders-error" role="alert">
          <span>{globalError}</span>
          <button type="button" onClick={() => setGlobalError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </main>
  );
}
