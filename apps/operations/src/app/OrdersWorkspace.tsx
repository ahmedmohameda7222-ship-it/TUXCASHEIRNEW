import type {
  OperationsSessionState,
  OrdersWorkspace as OrdersWorkspaceData,
} from '@tux/application';
import {
  ZERO_MONEY,
  addProductUnit,
  decrementDraftLine,
  decrementProductUnit,
  duplicateDraftLineUnit,
  normalizeEgyptianPhone,
  parseEntityId,
  productQuantityInDraft,
  replaceDraftLineCustomization,
  validateOrderDraft,
  type CategoryAlignment,
  type DraftLineCustomization,
  type DraftLineId,
  type MenuCategory,
  type MenuCategoryId,
  type OrderDraft,
  type OrderId,
  type OrderValidationIssue,
  type Product,
  type ProductId,
  type WorkerUiPreferences,
} from '@tux/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CART_WIDTH_MAX_PX,
  CART_WIDTH_MIN,
  clampCartWidth,
  readCartWidth,
  writeCartWidth,
} from './cartWidthPreference';
import { EditPencilIcon, SearchIcon } from './icons';
import { MenuProductCard } from './MenuProductCard';
import {
  filterProductsForMenu as filterProductsForMenuWithPreference,
  moveProductWithinCategory,
  reconcileProductOrder,
} from './menuProductOrder';
import { createWorkerUiPreferencesClient, type OperationsOrdersClient } from './sessionClient';
import { OrdersCart, type DraftMutation } from './OrdersCart';
import { ProductCustomizer, type ProductCustomizerTarget } from './ProductCustomizer';
import { formatMoneyMinor, nextDraftAddedSequence, resolveOrdersDraftScopeId } from './ordersView';

type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;

const DESKTOP_CART_RESIZE_QUERY = '(min-width: 54.0625rem)';
const CART_RESIZE_KEYBOARD_STEP = 24;

function desktopCartResizeMatches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_CART_RESIZE_QUERY).matches;
}

export function reconcileCategoryOrder(
  activeCategories: readonly MenuCategory[],
  preference: WorkerUiPreferences | null,
): readonly MenuCategory[] {
  if (preference === null || preference.categoryOrder.length === 0) return activeCategories;

  const byId = new Map(activeCategories.map((category) => [category.id, category]));
  const reconciled: MenuCategory[] = [];
  const seen = new Set<MenuCategoryId>();

  for (const categoryId of preference.categoryOrder) {
    const category = byId.get(categoryId);
    if (category === undefined || seen.has(categoryId)) continue;
    reconciled.push(category);
    seen.add(categoryId);
  }

  for (const category of activeCategories) {
    if (seen.has(category.id)) continue;
    reconciled.push(category);
    seen.add(category.id);
  }

  return reconciled;
}

export function productFamiliesForCategory(
  products: readonly Product[],
  categoryId: MenuCategoryId | null,
): readonly string[] {
  if (categoryId === null) return [];

  const seen = new Set<string>();
  const families: string[] = [];
  const categoryProducts = products
    .filter((product) => product.active && product.categoryId === categoryId)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);

  for (const product of categoryProducts) {
    const family = product.family?.trim();
    if (!family || seen.has(family)) continue;
    seen.add(family);
    families.push(family);
  }

  return families;
}

export function filterProductsForMenu(
  products: readonly Product[],
  options: {
    readonly selectedCategoryId: MenuCategoryId | null;
    readonly selectedFamily: string | null;
    readonly search: string;
  },
): readonly Product[] {
  const active = products.filter((product) => product.active);
  const query = options.search.trim().toLocaleLowerCase();

  if (query.length > 0) {
    return active
      .filter((product) => product.name.toLocaleLowerCase().includes(query))
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  if (options.selectedCategoryId === null) return [];

  return active
    .filter((product) => product.categoryId === options.selectedCategoryId)
    .filter(
      (product) => options.selectedFamily === null || product.family === options.selectedFamily,
    )
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

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
  busy,
  onClose,
}: {
  readonly product: Product;
  readonly busy: boolean;
  readonly onClose: () => void;
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
  const preferencesClient = useMemo(createWorkerUiPreferencesClient, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<OrderDraft | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const undoTimerRef = useRef<number | null>(null);
  const cartResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

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
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryMode, setCategoryMode] = useState<'IDLE' | 'SEARCH'>('IDLE');
  const [menuEditActive, setMenuEditActive] = useState(false);
  const [categoryPreference, setCategoryPreference] = useState<WorkerUiPreferences | null>(null);
  const [categoryEditOrder, setCategoryEditOrder] = useState<readonly MenuCategoryId[]>([]);
  const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('left');
  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);
  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);
  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);
  const [customizer, setCustomizer] = useState<ProductCustomizerTarget | null>(null);
  const [quickInfoProductId, setQuickInfoProductId] = useState<ProductId | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [desktopCartResizable, setDesktopCartResizable] = useState(desktopCartResizeMatches);
  const [cartWidth, setCartWidth] = useState(() =>
    typeof window === 'undefined'
      ? CART_WIDTH_MIN
      : readCartWidth(window.localStorage, window.innerWidth),
  );

  function commitCartWidth(nextWidth: number): void {
    const next = clampCartWidth(nextWidth, window.innerWidth);
    setCartWidth(next);
    writeCartWidth(window.localStorage, next);
  }

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
      const defaultCategoryId = categories[0]?.id ?? null;
      setSelectedCategoryId((current) =>
        current !== null && categories.some((category) => category.id === current)
          ? current
          : defaultCategoryId,
      );
      setSelectedFamily(null);
    });
    return () => {
      cancelled = true;
    };
  }, [client, draftScopeId, session.businessDayId, session.operator.id]);

  useEffect(() => {
    let cancelled = false;
    setCategoryPreference(null);
    setCategoryMode('IDLE');
    setMenuEditActive(false);
    setSearch('');
    void preferencesClient
      .load()
      .then((preference) => {
        if (!cancelled) setCategoryPreference(preference);
      })
      .catch(() => {
        if (!cancelled) setCategoryPreference(null);
      });
    return () => {
      cancelled = true;
    };
  }, [preferencesClient, session.operator.id]);

  useEffect(() => {
    if (categoryMode === 'SEARCH') searchRef.current?.focus();
  }, [categoryMode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const targetIsEditor =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (menuEditActive) return;
        event.preventDefault();
        setCategoryMode('SEARCH');
        return;
      }
      if (event.key === '/' && !targetIsEditor && !menuEditActive) {
        event.preventDefault();
        setCategoryMode('SEARCH');
        return;
      }
      if (event.key === 'Escape' && categoryMode === 'SEARCH') {
        event.preventDefault();
        if (search.length > 0) {
          setSearch('');
          searchRef.current?.focus();
        } else {
          setCategoryMode('IDLE');
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [categoryMode, menuEditActive, search]);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_CART_RESIZE_QUERY);
    const sync = () => setDesktopCartResizable(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    function clampToViewport(): void {
      if (!desktopCartResizeMatches()) return;
      setCartWidth((current) => {
        const next = clampCartWidth(current, window.innerWidth);
        if (next !== current) writeCartWidth(window.localStorage, next);
        return next;
      });
    }

    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

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
  const configuredActiveCategories = useMemo(
    () =>
      configuration?.categories
        .filter((category) => category.active)
        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],
    [configuration],
  );
  const activeCategories = useMemo(
    () => reconcileCategoryOrder(configuredActiveCategories, categoryPreference),
    [categoryPreference, configuredActiveCategories],
  );
  const categoryAlignment = categoryPreference?.categoryAlignment ?? 'left';
  const categoryEditorCategories = useMemo(() => {
    const byId = new Map(configuredActiveCategories.map((category) => [category.id, category]));
    return categoryEditOrder.flatMap((categoryId) => {
      const category = byId.get(categoryId);
      return category === undefined ? [] : [category];
    });
  }, [categoryEditOrder, configuredActiveCategories]);
  const activeFamilies = useMemo(() => {
    const selectedCategory = activeCategories.find(
      (category) => category.id === selectedCategoryId,
    );
    if (selectedCategory?.name.trim().toLocaleLowerCase() !== 'burgers') return [];
    return productFamiliesForCategory(configuration?.products ?? [], selectedCategoryId);
  }, [activeCategories, configuration, selectedCategoryId]);

  useEffect(() => {
    if (selectedFamily !== null && !activeFamilies.includes(selectedFamily)) {
      setSelectedFamily(null);
    }
  }, [activeFamilies, selectedFamily]);

  const products = useMemo(
    () =>
      filterProductsForMenuWithPreference(
        configuration?.products ?? [],
        {
          selectedCategoryId,
          selectedFamily,
          search,
        },
        categoryPreference,
      ),
    [categoryPreference, configuration, search, selectedCategoryId, selectedFamily],
  );
  const menuEditProducts = useMemo(() => {
    if (selectedCategoryId === null) return [];
    const byId = new Map(
      (configuration?.products ?? [])
        .filter((product) => product.active)
        .map((product) => [product.id, product]),
    );
    return menuEditProductOrder.flatMap((productId) => {
      const product = byId.get(productId);
      return product !== undefined && product.categoryId === selectedCategoryId ? [product] : [];
    });
  }, [configuration, menuEditProductOrder, selectedCategoryId]);

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

  function beginMenuEdit(): void {
    setSearch('');
    setCategoryEditOrder(activeCategories.map((category) => category.id));
    setCategoryEditAlignment(categoryAlignment);
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    );
    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditActive(true);
  }

  function moveDraggedCategory(targetId: MenuCategoryId): void {
    const sourceId = draggedCategoryId;
    if (sourceId === null || sourceId === targetId) return;
    setCategoryEditOrder((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      if (moved === undefined) return current;
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function moveDraggedProduct(targetId: ProductId): void {
    const sourceId = draggedProductId;
    if (sourceId === null || sourceId === targetId || selectedCategoryId === null) return;
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      return moveProductWithinCategory(current, categoryProductIds, sourceId, targetId);
    });
  }

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

  function incrementLine(lineId: DraftLineId): void {
    if (draftRef.current === null || configuration === null) return;
    enqueueMutation((current) =>
      duplicateDraftLineUnit({
        draft: current,
        configuration,
        lineId,
        newLineId: parseEntityId<DraftLineId>(crypto.randomUUID()),
        addedSequence: nextDraftAddedSequence(current),
      }),
    );
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
    <main
      className="orders-workspace"
      style={
        desktopCartResizable
          ? { gridTemplateColumns: `minmax(0, 1fr) 0.5rem ${cartWidth}px` }
          : undefined
      }
    >
      <section className="menu-pane" aria-label="Menu">
        <>
          <div
            className={
              menuEditActive
                ? 'menu-toolbar category-mode-edit'
                : `menu-toolbar category-mode-${categoryMode.toLowerCase()}`
            }
          >
            <div className="field-stack category-navigation-stack">
              <div className="category-navigation">
                <div
                  className="category-rail"
                  aria-label="Menu categories"
                  data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}
                >
                  {(menuEditActive ? categoryEditorCategories : activeCategories).map(
                    (category) => (
                      <button
                        type="button"
                        key={category.id}
                        className={[
                          'category-tab',
                          selectedCategoryId === category.id ? 'selected' : '',
                          menuEditActive ? 'category-tab-reordering' : '',
                          draggedCategoryId === category.id ? 'category-tab-dragging' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        draggable={menuEditActive && draggedCategoryId !== category.id}
                        onDragStart={(event) => {
                          if (!menuEditActive) return;
                          setDraggedCategoryId(category.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', category.id);
                        }}
                        onDragEnter={(event) => {
                          if (!menuEditActive || draggedCategoryId === null) return;
                          event.preventDefault();
                          moveDraggedCategory(category.id);
                        }}
                        onDragOver={(event) => {
                          if (menuEditActive && draggedCategoryId !== null) event.preventDefault();
                        }}
                        onDragEnd={() => setDraggedCategoryId(null)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedCategoryId(null);
                        }}
                        onClick={() => {
                          setSelectedCategoryId(category.id);
                          setSelectedFamily(null);
                          setSearch('');
                        }}
                      >
                        {category.name}
                      </button>
                    ),
                  )}
                </div>
                <div className="category-nav-actions">
                  {menuEditActive ? (
                    <div
                      className="category-alignment category-alignment-inline"
                      role="group"
                      aria-label="Category alignment"
                    >
                      {(['left', 'center', 'right'] as const).map((alignment) => (
                        <button
                          type="button"
                          key={alignment}
                          aria-pressed={categoryEditAlignment === alignment}
                          onClick={() => setCategoryEditAlignment(alignment)}
                        >
                          {alignment === 'left'
                            ? 'Left'
                            : alignment === 'center'
                              ? 'Center'
                              : 'Right'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {categoryMode === 'IDLE' ? (
                    <button
                      type="button"
                      className={
                        menuEditActive
                          ? 'category-icon-action category-edit-active'
                          : 'category-icon-action'
                      }
                      aria-label="Edit menu"
                      title="Edit menu"
                      aria-pressed={menuEditActive}
                      onClick={() => {
                        if (!menuEditActive) beginMenuEdit();
                      }}
                    >
                      <EditPencilIcon />
                    </button>
                  ) : null}
                  {!menuEditActive && categoryMode === 'SEARCH' ? (
                    <div className="product-search category-search-inline">
                      <SearchIcon className="category-search-glyph" />
                      <input
                        ref={searchRef}
                        id="product-search"
                        type="search"
                        aria-label="Search menu"
                        value={search}
                        placeholder="Search products"
                        autoComplete="off"
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <button
                        type="button"
                        className="category-search-clear"
                        aria-label="Clear search"
                        title="Clear search"
                        onClick={() => {
                          setSearch('');
                          setCategoryMode('IDLE');
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : !menuEditActive ? (
                    <button
                      type="button"
                      className="category-icon-action"
                      aria-label="Search menu"
                      title="Search menu"
                      onClick={() => setCategoryMode('SEARCH')}
                    >
                      <SearchIcon />
                    </button>
                  ) : null}
                </div>
              </div>
              {!menuEditActive && activeFamilies.length > 0 ? (
                <div
                  className="segmented-control product-family-filter"
                  aria-label="Product families"
                >
                  <button
                    type="button"
                    className={selectedFamily === null ? 'selected' : undefined}
                    onClick={() => setSelectedFamily(null)}
                  >
                    All
                  </button>
                  {activeFamilies.map((family) => (
                    <button
                      type="button"
                      key={family}
                      className={selectedFamily === family ? 'selected' : undefined}
                      onClick={() => setSelectedFamily(family)}
                    >
                      {family}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="product-grid" aria-live="polite">
            {menuEditActive ? (
              menuEditProducts.length === 0 ? (
                <div className="menu-empty">
                  <strong>No products found</strong>
                  <span>This category has no active products.</span>
                </div>
              ) : (
                menuEditProducts.map((product) => (
                  <article
                    key={product.id}
                    className={[
                      'product-card',
                      'menu-edit-product-card',
                      draggedProductId === product.id ? 'menu-edit-product-card-dragging' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    draggable={menuEditActive && draggedProductId !== product.id}
                    tabIndex={0}
                    aria-label={`Reorder ${product.name}`}
                    onDragStart={(event) => {
                      setDraggedProductId(product.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', product.id);
                    }}
                    onDragEnter={(event) => {
                      if (draggedProductId === null) return;
                      event.preventDefault();
                      moveDraggedProduct(product.id);
                    }}
                    onDragOver={(event) => {
                      if (draggedProductId !== null) event.preventDefault();
                    }}
                    onDragEnd={() => setDraggedProductId(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDraggedProductId(null);
                    }}
                  >
                    <div className="product-main">
                      <div className="product-media">
                        <ProductImage product={product} />
                      </div>
                      <div className="product-copy">
                        <strong>{product.name}</strong>
                        {product.description?.trim() ? <p>{product.description}</p> : null}
                      </div>
                      <strong className="product-price">
                        {formatMoneyMinor(product.priceMinor)}
                      </strong>
                    </div>
                    <div className="menu-edit-product-hint" aria-hidden="true">
                      Drag to reorder
                    </div>
                  </article>
                ))
              )
            ) : products.length === 0 ? (
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
                  onExtras={() =>
                    setCustomizer({ kind: 'ADD', productId: product.id, focusSection: 'EXTRAS' })
                  }
                />
              ))
            )}
          </div>
        </>
      </section>

      {desktopCartResizable ? (
        <div
          className="cart-resize-separator"
          role="separator"
          aria-label="Resize Current Order"
          aria-orientation="vertical"
          aria-valuemin={CART_WIDTH_MIN}
          aria-valuemax={Math.floor(Math.min(CART_WIDTH_MAX_PX, window.innerWidth * 0.45))}
          aria-valuenow={Math.round(cartWidth)}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              commitCartWidth(cartWidth + CART_RESIZE_KEYBOARD_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              commitCartWidth(cartWidth - CART_RESIZE_KEYBOARD_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              commitCartWidth(CART_WIDTH_MIN);
            } else if (event.key === 'End') {
              event.preventDefault();
              commitCartWidth(CART_WIDTH_MAX_PX);
            }
          }}
          onPointerDown={(event) => {
            cartResizeRef.current = { startX: event.clientX, startWidth: cartWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = cartResizeRef.current;
            if (drag === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            commitCartWidth(drag.startWidth + drag.startX - event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            cartResizeRef.current = null;
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            cartResizeRef.current = null;
          }}
        />
      ) : null}

      <div className="desktop-cart-wrap">
        <OrdersCart
          draft={draft}
          configuration={configuration}
          issues={visibleIssues}
          busy={saving}
          placing={placing}
          onMutate={enqueueMutation}
          onEditLine={(lineId) => setCustomizer({ kind: 'EDIT', lineId })}
          onEditLineExtras={(lineId) =>
            setCustomizer({ kind: 'EDIT', lineId, focusSection: 'EXTRAS' })
          }
          onDecrementLine={decrementLine}
          onIncrementLine={incrementLine}
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
            <strong>Review & pay</strong>
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
            onEditLineExtras={(lineId) =>
              setCustomizer({ kind: 'EDIT', lineId, focusSection: 'EXTRAS' })
            }
            onDecrementLine={decrementLine}
            onIncrementLine={incrementLine}
            onClear={() => setClearConfirmOpen(true)}
            onDeliveryPhoneCommit={commitDeliveryPhone}
            onPlace={() => void placeOrder()}
          />
        </div>
      ) : null}

      {customizer === null ? null : (
        <ProductCustomizer
          key={
            customizer.kind === 'ADD'
              ? `add:${customizer.productId}:${customizer.focusSection ?? 'FULL'}`
              : `edit:${customizer.lineId}:${customizer.focusSection ?? 'FULL'}`
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
          onClose={() => setQuickInfoProductId(null)}
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
