import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  workerMenuLayoutUpdateFromFlatProductOrder,
  type OperationsSessionState,
  type OrdersCustomerPrefill,
  type OrdersWorkspace as OrdersWorkspaceData,
} from '@tux/application';
import {
  ZERO_MONEY,
  addProductUnit,
  decrementDraftLine,
  decrementProductUnit,
  duplicateDraftLineUnit,
  hasMeaningfulOrderDraft,
  normalizeEgyptianPhone,
  parseEntityId,
  productQuantityInDraft,
  replaceDraftLineCustomization,
  validateOrderDraft,
  type DraftLineCustomization,
  type DraftLineId,
  type MenuCategory,
  type MenuCategoryId,
  type OrderDraft,
  type OrderId,
  type OrderValidationIssue,
  type Product,
  type ProductId,
  type WorkerMenuLayout,
} from '@tux/domain';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  CART_WIDTH_MAX_PX,
  CART_WIDTH_MIN,
  clampCartWidth,
  readCartWidth,
  writeCartWidth,
} from './cartWidthPreference';
import { EditPencilIcon, SearchIcon } from './icons';
import {
  createClosedMenuLayoutEditorSession,
  createWorkerMenuPreferenceLoadSession,
  menuLayoutEditorReducer,
  workerMenuPreferenceLoadReducer,
  type MenuLayoutDraft,
  type WorkerMenuPreferenceLoadState,
} from './menuLayoutEditorSession';
import { MenuEditProductCard, menuEditProductSortableId } from './MenuEditProductCard';
import { MenuProductCard } from './MenuProductCard';
import { ProductCardPresentation } from './ProductCardPresentation';
import {
  filterProductsForMenu as filterProductsForMenuWithPreference,
  moveProductWithinCategory,
  reconcileProductOrder,
} from './menuProductOrder';
import { createWorkerMenuLayoutClient, type OperationsOrdersClient } from './sessionClient';
import { OrdersCart, type DraftMutation } from './OrdersCart';
import { ProductCustomizer, type ProductCustomizerTarget } from './ProductCustomizer';
import { formatMoneyMinor, nextDraftAddedSequence, resolveOrdersDraftScopeId } from './ordersView';
import { shouldEnsureSelectedCategoryVisible } from './selectedCategoryVisibility';
import type { MenuLayoutExitController } from './unsavedChangesGuard';

type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;

const DESKTOP_CART_RESIZE_QUERY = '(min-width: 54.0625rem)';
const CART_RESIZE_KEYBOARD_STEP = 24;
const MENU_EDIT_MEASURING = {
  droppable: { strategy: MeasuringStrategy.BeforeDragging },
};

function desktopCartResizeMatches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_CART_RESIZE_QUERY).matches;
}

export function reconcileCategoryOrder(
  activeCategories: readonly MenuCategory[],
  preference: WorkerMenuLayout | null,
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

export function resolveWorkerMenuPreferencePresentation(state: WorkerMenuPreferenceLoadState): {
  readonly preference: WorkerMenuLayout | null;
  readonly menuEditEnabled: boolean;
  readonly errorMessage: string | null;
  readonly retryVisible: boolean;
} {
  if (state.status === 'READY') {
    return {
      preference: state.preference,
      menuEditEnabled: true,
      errorMessage: null,
      retryVisible: false,
    };
  }
  if (state.status === 'ERROR') {
    return {
      preference: null,
      menuEditEnabled: false,
      errorMessage: state.message,
      retryVisible: true,
    };
  }
  return {
    preference: null,
    menuEditEnabled: false,
    errorMessage: null,
    retryVisible: false,
  };
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

function menuEditCategorySortableId(categoryId: MenuCategoryId): string {
  return `category:${categoryId}`;
}

function MenuEditCategoryTab({
  category,
  selected,
  disabled,
  onSelect,
  onNodeRef,
}: {
  readonly category: MenuCategory;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly onNodeRef: (node: HTMLButtonElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: menuEditCategorySortableId(category.id),
    disabled,
  });
  const setCombinedNodeRef = useCallback(
    (node: HTMLButtonElement | null): void => {
      setNodeRef(node);
      onNodeRef(node);
    },
    [onNodeRef, setNodeRef],
  );

  return (
    <button
      ref={setCombinedNodeRef}
      type="button"
      disabled={disabled}
      className={[
        'category-tab',
        selected ? 'selected' : '',
        'category-tab-reordering',
        isDragging ? 'category-tab-dragging category-tab-grabbed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {category.name}
    </button>
  );
}

export interface OrdersWorkspacePrefillIntent {
  readonly requestId: string;
  readonly prefill: OrdersCustomerPrefill;
}

export function OrdersWorkspace({
  session,
  client,
  prefillIntent,
  onPrefillIntentHandled,
  onMenuLayoutExitControllerChange,
}: {
  readonly session: ActiveSession;
  readonly client: OperationsOrdersClient;
  readonly prefillIntent?: OrdersWorkspacePrefillIntent | null;
  readonly onPrefillIntentHandled?: () => void;
  readonly onMenuLayoutExitControllerChange?: (controller: MenuLayoutExitController) => void;
}) {
  const draftScopeId = useMemo(resolveOrdersDraftScopeId, []);
  const menuLayoutClient = useMemo(createWorkerMenuLayoutClient, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryRailRef = useRef<HTMLDivElement>(null);
  const categoryTabRefs = useRef<Map<MenuCategoryId, HTMLButtonElement>>(new Map());
  const lastAppliedMenuDragTargetRef = useRef<string | null>(null);
  const pendingKeyboardDragTargetRef = useRef<string | null>(null);
  const draftRef = useRef<OrderDraft | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const undoTimerRef = useRef<number | null>(null);
  const cartResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const preferenceLoadGenerationRef = useRef(0);
  const menuEditIdentityRef = useRef({ shopId: session.shopId, workerId: session.operator.id });
  menuEditIdentityRef.current = { shopId: session.shopId, workerId: session.operator.id };

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
  const [workerMenuPreferenceLoadSession, dispatchWorkerMenuPreferenceLoad] = useReducer(
    workerMenuPreferenceLoadReducer,
    createWorkerMenuPreferenceLoadSession(session.shopId, session.operator.id, 0),
  );
  const [menuEditSession, dispatchMenuLayoutEditor] = useReducer(
    menuLayoutEditorReducer,
    createClosedMenuLayoutEditorSession(),
  );
  const [activeMenuDragId, setActiveMenuDragId] = useState<string | null>(null);
  const [menuEditAnnouncement, setMenuEditAnnouncement] = useState('');
  const [customizer, setCustomizer] = useState<ProductCustomizerTarget | null>(null);
  const [quickInfoProductId, setQuickInfoProductId] = useState<ProductId | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [prefillConflict, setPrefillConflict] = useState<OrdersWorkspacePrefillIntent | null>(null);
  const [restoreConflictDraftId, setRestoreConflictDraftId] = useState<string | null>(null);
  const [discardParkedDraftId, setDiscardParkedDraftId] = useState<string | null>(null);
  const handledPrefillRequestRef = useRef<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [desktopCartResizable, setDesktopCartResizable] = useState(desktopCartResizeMatches);
  const [cartWidth, setCartWidth] = useState(() =>
    typeof window === 'undefined'
      ? CART_WIDTH_MIN
      : readCartWidth(window.localStorage, window.innerWidth),
  );
  const menuEditActive = menuEditSession.lifecycle !== 'CLOSED';
  const menuEditSaving = menuEditSession.lifecycle === 'SAVING';
  const menuEditError = menuEditSession.saveError;
  const categoryEditOrder = menuEditSession.draft?.categoryOrder ?? [];
  const categoryEditAlignment = menuEditSession.draft?.categoryAlignment ?? 'left';
  const menuEditProductOrder = menuEditSession.draft?.productOrder ?? [];
  const menuEditKeyboardCoordinateGetter = useCallback<typeof sortableKeyboardCoordinates>(
    (event, args) => {
      const direction = event.code;
      if (
        direction !== 'ArrowLeft' &&
        direction !== 'ArrowRight' &&
        direction !== 'ArrowUp' &&
        direction !== 'ArrowDown'
      ) {
        pendingKeyboardDragTargetRef.current = null;
        return sortableKeyboardCoordinates(event, args);
      }

      event.preventDefault();
      const active = args.context.active;
      const collisionRect = args.context.collisionRect;
      if (active === null || collisionRect === null) {
        pendingKeyboardDragTargetRef.current = null;
        return args.currentCoordinates;
      }

      const activeRect = args.context.droppableRects.get(active.id) ?? collisionRect;
      const activeCenterX = activeRect.left + activeRect.width / 2;
      const activeCenterY = activeRect.top + activeRect.height / 2;
      const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
      const candidates = args.context.droppableContainers
        .getEnabled()
        .flatMap((container) => {
          if (container.id === active.id) return [];
          const rect = args.context.droppableRects.get(container.id);
          if (rect === undefined) return [];
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          if (horizontal) {
            const rowTolerance = Math.max(activeRect.height, rect.height) / 2;
            if (Math.abs(centerY - activeCenterY) > rowTolerance) return [];
            if (direction === 'ArrowLeft' && centerX >= activeCenterX - 1) return [];
            if (direction === 'ArrowRight' && centerX <= activeCenterX + 1) return [];
            return [
              {
                container,
                rect,
                primaryDistance: Math.abs(centerX - activeCenterX),
                crossDistance: Math.abs(centerY - activeCenterY),
              },
            ];
          }

          if (direction === 'ArrowUp' && centerY >= activeCenterY - 1) return [];
          if (direction === 'ArrowDown' && centerY <= activeCenterY + 1) return [];
          return [
            {
              container,
              rect,
              primaryDistance: Math.abs(centerY - activeCenterY),
              crossDistance: Math.abs(centerX - activeCenterX),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.primaryDistance - right.primaryDistance ||
            left.crossDistance - right.crossDistance,
        );
      const target = candidates[0];
      if (target === undefined) {
        pendingKeyboardDragTargetRef.current = null;
        return args.currentCoordinates;
      }

      pendingKeyboardDragTargetRef.current = String(target.container.id);
      target.container.node.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { x: target.rect.left, y: target.rect.top };
    },
    [],
  );
  const menuEditSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: menuEditKeyboardCoordinateGetter }),
  );

  const activeWorkerMenuPreferenceLoadState: WorkerMenuPreferenceLoadState =
    workerMenuPreferenceLoadSession.shopId === session.shopId &&
    workerMenuPreferenceLoadSession.workerId === session.operator.id
      ? workerMenuPreferenceLoadSession.state
      : { status: 'LOADING' };
  const workerMenuPreferencePresentation = resolveWorkerMenuPreferencePresentation(
    activeWorkerMenuPreferenceLoadState,
  );
  const categoryPreference = workerMenuPreferencePresentation.preference;
  const discardMenuLayoutEditor = useCallback((): void => {
    dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
    dispatchMenuLayoutEditor({ type: 'CANCEL_EDITOR' });
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('');
  }, []);
  const setCategoryTabRef = useCallback(
    (categoryId: MenuCategoryId, node: HTMLButtonElement | null): void => {
      if (node === null) categoryTabRefs.current.delete(categoryId);
      else categoryTabRefs.current.set(categoryId, node);
    },
    [],
  );
  const ensureSelectedCategoryVisible = useCallback((): void => {
    if (selectedCategoryId === null) return;
    const rail = categoryRailRef.current;
    const selectedTab = categoryTabRefs.current.get(selectedCategoryId);
    if (rail === null || selectedTab === undefined) return;
    const railBounds = rail.getBoundingClientRect();
    const selectedTabBounds = selectedTab.getBoundingClientRect();
    if (!shouldEnsureSelectedCategoryVisible(railBounds, selectedTabBounds)) return;
    selectedTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedCategoryId]);

  useEffect(() => {
    if (onMenuLayoutExitControllerChange === undefined) return;
    onMenuLayoutExitControllerChange({
      state: {
        lifecycle: menuEditSession.lifecycle,
        dirty: menuEditSession.dirty,
      },
      discard: discardMenuLayoutEditor,
    });
  }, [
    discardMenuLayoutEditor,
    menuEditSession.dirty,
    menuEditSession.lifecycle,
    onMenuLayoutExitControllerChange,
  ]);

  useEffect(() => {
    if (onMenuLayoutExitControllerChange === undefined) return;
    return () => {
      onMenuLayoutExitControllerChange({
        state: { lifecycle: 'CLOSED', dirty: false },
        discard: () => undefined,
      });
    };
  }, [onMenuLayoutExitControllerChange]);

  useEffect(() => {
    if (!menuEditSession.dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [menuEditSession.dirty]);

  useEffect(() => {
    if (!menuEditActive) return;
    ensureSelectedCategoryVisible();
  }, [ensureSelectedCategoryVisible, menuEditActive]);

  useEffect(() => {
    if (!menuEditActive || typeof ResizeObserver === 'undefined') return;
    const rail = categoryRailRef.current;
    if (rail === null) return;
    const observer = new ResizeObserver(() => ensureSelectedCategoryVisible());
    observer.observe(rail);
    return () => observer.disconnect();
  }, [ensureSelectedCategoryVisible, menuEditActive]);

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

  function setCurrentWorkspace(next: OrdersWorkspaceData): void {
    setWorkspace(next);
    draftRef.current = next.draft;
    setDraft(next.draft);
  }

  async function startFromPrefill(
    intent: OrdersWorkspacePrefillIntent,
    parkCurrent: boolean,
  ): Promise<void> {
    setGlobalError(null);
    const result = parkCurrent
      ? await client.startOrderFromCustomerPrefill({
          draftScopeId,
          prefill: intent.prefill,
          parkCurrent: true,
        })
      : await client.startOrderFromCustomerPrefill({
          draftScopeId,
          prefill: intent.prefill,
          parkCurrent: false,
        });
    if (!result.ok) {
      setGlobalError(result.error.message);
      return;
    }
    setCurrentWorkspace(result.value);
    setPrefillConflict(null);
    handledPrefillRequestRef.current = intent.requestId;
    onPrefillIntentHandled?.();
  }

  async function restoreParkedOrder(parkedDraftId: string, parkCurrent: boolean): Promise<void> {
    setGlobalError(null);
    const result = await client.restoreParkedDraft({ draftScopeId, parkedDraftId, parkCurrent });
    if (!result.ok) {
      setGlobalError(result.error.message);
      return;
    }
    setCurrentWorkspace(result.value);
    setRestoreConflictDraftId(null);
  }

  async function discardParkedOrder(parkedDraftId: string): Promise<void> {
    setGlobalError(null);
    const result = await client.discardParkedDraft({ parkedDraftId });
    if (!result.ok) {
      setGlobalError(result.error.message);
      return;
    }
    const reloaded = await client.loadWorkspace(draftScopeId);
    if (!reloaded.ok) {
      setGlobalError(reloaded.error.message);
      return;
    }
    setCurrentWorkspace(reloaded.value);
    setDiscardParkedDraftId(null);
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
    if (workspace === null || draft === null || prefillIntent == null) return;
    if (handledPrefillRequestRef.current === prefillIntent.requestId) return;
    if (hasMeaningfulOrderDraft(draft)) {
      setPrefillConflict(prefillIntent);
      return;
    }
    handledPrefillRequestRef.current = prefillIntent.requestId;
    void startFromPrefill(prefillIntent, false);
  }, [draft, prefillIntent?.requestId, workspace]);

  useEffect(() => {
    const shopId = session.shopId;
    const workerId = session.operator.id;
    const generation = preferenceLoadGenerationRef.current + 1;
    preferenceLoadGenerationRef.current = generation;
    dispatchWorkerMenuPreferenceLoad({ type: 'LOAD', shopId, workerId, generation });
    dispatchMenuLayoutEditor({ type: 'IDENTITY_INVALIDATED', shopId, workerId });
    setCategoryMode('IDLE');
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('');
    setSearch('');
    void menuLayoutClient.load().then(
      (preference) => {
        dispatchWorkerMenuPreferenceLoad({
          type: 'READY',
          shopId,
          workerId,
          generation,
          preference,
        });
      },
      () => {
        dispatchWorkerMenuPreferenceLoad({
          type: 'ERROR',
          shopId,
          workerId,
          generation,
          message: 'Menu customization could not be loaded. Retry to enable Menu Edit.',
        });
      },
    );
  }, [menuLayoutClient, session.operator.id, session.shopId]);

  useEffect(() => {
    const shopId = session.shopId;
    const workerId = session.operator.id;
    return menuLayoutClient.subscribe((layout) => {
      if (layout.shopId !== shopId || layout.workerId !== workerId) return;
      dispatchWorkerMenuPreferenceLoad({
        type: 'READY',
        shopId,
        workerId,
        generation: preferenceLoadGenerationRef.current,
        preference: layout,
      });
    });
  }, [menuLayoutClient, session.operator.id, session.shopId]);

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
        event.preventDefault();
        if (menuEditActive) return;
        setCategoryMode('SEARCH');
        return;
      }
      if (event.key === '/' && !targetIsEditor) {
        event.preventDefault();
        if (menuEditActive) return;
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
  const categorySortableIds = useMemo(
    () => categoryEditorCategories.map((category) => menuEditCategorySortableId(category.id)),
    [categoryEditorCategories],
  );
  const productSortableIds = useMemo(
    () => menuEditProducts.map((product) => menuEditProductSortableId(product.id)),
    [menuEditProducts],
  );
  const activeDraggedCategory =
    activeMenuDragId === null
      ? null
      : (categoryEditorCategories.find(
          (category) => menuEditCategorySortableId(category.id) === activeMenuDragId,
        ) ?? null);
  const activeDraggedProduct =
    activeMenuDragId === null
      ? null
      : (menuEditProducts.find(
          (product) => menuEditProductSortableId(product.id) === activeMenuDragId,
        ) ?? null);

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

  function retryWorkerMenuPreferenceLoad(): void {
    const shopId = session.shopId;
    const workerId = session.operator.id;
    const generation = preferenceLoadGenerationRef.current + 1;
    preferenceLoadGenerationRef.current = generation;
    dispatchWorkerMenuPreferenceLoad({ type: 'LOAD', shopId, workerId, generation });
    void menuLayoutClient.load().then(
      (preference) => {
        dispatchWorkerMenuPreferenceLoad({
          type: 'READY',
          shopId,
          workerId,
          generation,
          preference,
        });
      },
      () => {
        dispatchWorkerMenuPreferenceLoad({
          type: 'ERROR',
          shopId,
          workerId,
          generation,
          message: 'Menu customization could not be loaded. Retry to enable Menu Edit.',
        });
      },
    );
  }

  function beginMenuEdit(): void {
    if (!workerMenuPreferencePresentation.menuEditEnabled) return;
    const base: MenuLayoutDraft = {
      categoryOrder: activeCategories.map((category) => category.id),
      categoryAlignment,
      productOrder: reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    };
    dispatchMenuLayoutEditor({
      type: 'OPEN',
      shopId: session.shopId,
      workerId: session.operator.id,
      base,
    });
    setCategoryMode('IDLE');
    setSearch('');
    setSelectedFamily(null);
    setActiveMenuDragId(null);
    setMenuEditAnnouncement(
      'Menu edit mode. Drag categories or products to reorder. Keyboard users can pick up an item with Space and move it with the arrow keys.',
    );
  }

  function selectMenuEditCategory(categoryId: MenuCategoryId): void {
    if (menuEditSaving) return;
    dispatchMenuLayoutEditor({ type: 'CATEGORY_CHANGE' });
    setSelectedCategoryId(categoryId);
    setSelectedFamily(null);
    setSearch('');
  }

  function resetMenuEdit(): void {
    if (menuEditSaving) return;
    const draft: MenuLayoutDraft = {
      categoryOrder: configuredActiveCategories.map((category) => category.id),
      categoryAlignment: 'left',
      productOrder: reconcileProductOrder(configuration?.products ?? [], null).map(
        (product) => product.id,
      ),
    };
    dispatchMenuLayoutEditor({ type: 'RESET', draft });
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('Menu layout reset to defaults. Save to keep the reset.');
  }

  function cancelMenuEdit(): void {
    if (menuEditSaving) return;
    discardMenuLayoutEditor();
  }

  async function saveMenuEdit(): Promise<void> {
    if (menuEditSaving) return;
    const saveDraft = menuEditSession.draft;
    const saveShopId = menuEditSession.openingShopId;
    const saveWorkerId = menuEditSession.openingWorkerId;
    if (saveDraft === null || saveShopId === null || saveWorkerId === null) return;
    const saveGeneration = workerMenuPreferenceLoadSession.generation;
    const saveToken = crypto.randomUUID();
    dispatchMenuLayoutEditor({ type: 'BEGIN_SAVE', saveToken });
    setActiveMenuDragId(null);
    try {
      let saved: WorkerMenuLayout | null;
      if (menuEditSession.resetRequested) {
        await menuLayoutClient.resetMenuLayout();
        saved = await menuLayoutClient.load();
        if (saved === null) throw new Error('Menu layout reset could not be reloaded.');
      } else {
        if (configuration === null) throw new Error('Menu configuration is unavailable.');
        saved = await menuLayoutClient.updateMenuLayout(
          workerMenuLayoutUpdateFromFlatProductOrder({
            categoryOrder: saveDraft.categoryOrder,
            categoryAlignment: saveDraft.categoryAlignment,
            productOrder: saveDraft.productOrder,
            catalog: {
              categories: configuration.categories,
              products: configuration.products,
            },
          }),
        );
      }
      if (
        menuEditIdentityRef.current.shopId !== saveShopId ||
        menuEditIdentityRef.current.workerId !== saveWorkerId
      ) {
        return;
      }
      dispatchWorkerMenuPreferenceLoad({
        type: 'READY',
        shopId: saveShopId,
        workerId: saveWorkerId,
        generation: saveGeneration,
        preference: saved,
      });
      dispatchMenuLayoutEditor({
        type: 'SAVE_SUCCESS',
        shopId: saveShopId,
        workerId: saveWorkerId,
        saveToken,
      });
      setActiveMenuDragId(null);
      setMenuEditAnnouncement('');
      setSuccessMessage('Menu layout saved');
      window.setTimeout(() => setSuccessMessage(null), 4_500);
    } catch {
      if (
        menuEditIdentityRef.current.shopId !== saveShopId ||
        menuEditIdentityRef.current.workerId !== saveWorkerId
      ) {
        return;
      }
      dispatchMenuLayoutEditor({
        type: 'SAVE_FAILURE',
        shopId: saveShopId,
        workerId: saveWorkerId,
        saveToken,
        message: 'Could not save menu layout. Try again.',
      });
    }
  }

  function handleMenuEditDragStart(event: DragStartEvent): void {
    if (menuEditSaving) return;
    if (!menuEditActive) return;
    const activeId = String(event.active.id);
    lastAppliedMenuDragTargetRef.current = activeId;
    pendingKeyboardDragTargetRef.current = null;
    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    if (activeCategory !== undefined) {
      dispatchMenuLayoutEditor({
        type: 'BEGIN_CATEGORY_PICKUP',
        categoryId: activeCategory.id,
      });
      setActiveMenuDragId(activeId);
      setMenuEditAnnouncement(`${activeCategory.name} picked up.`);
      return;
    }
    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    if (activeProduct === undefined || selectedCategoryId === null) return;
    dispatchMenuLayoutEditor({
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: activeProduct.id,
      categoryId: selectedCategoryId,
    });
    setActiveMenuDragId(activeId);
    setMenuEditAnnouncement(`${activeProduct.name} picked up.`);
  }

  function handleMenuEditDragCancel(): void {
    if (menuEditSaving) return;
    dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
    setActiveMenuDragId(null);
    lastAppliedMenuDragTargetRef.current = null;
    pendingKeyboardDragTargetRef.current = null;
  }

  function applyMenuEditDragOver(activeId: string, overId: string): boolean {
    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    const overCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === overId,
    );
    if (activeCategory !== undefined && overCategory !== undefined) {
      if (activeCategory.id === overCategory.id) return true;
      const sourceIndex = categoryEditOrder.indexOf(activeCategory.id);
      const targetIndex = categoryEditOrder.indexOf(overCategory.id);
      if (sourceIndex < 0 || targetIndex < 0) return false;
      const next = [...categoryEditOrder];
      const [moved] = next.splice(sourceIndex, 1);
      if (moved === undefined) return false;
      next.splice(targetIndex, 0, moved);
      dispatchMenuLayoutEditor({ type: 'SET_CATEGORY_ORDER', categoryOrder: next });
      setMenuEditAnnouncement(
        `${activeCategory.name} moved to position ${targetIndex + 1} of ${next.length}.`,
      );
      return true;
    }

    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    const overProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === overId,
    );
    if (
      activeProduct === undefined ||
      overProduct === undefined ||
      selectedCategoryId === null ||
      activeProduct.categoryId !== selectedCategoryId ||
      overProduct.categoryId !== selectedCategoryId
    ) {
      return false;
    }
    if (activeProduct.id === overProduct.id) return true;

    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    const categoryProductIds = menuEditProductOrder.filter(
      (productId) => productCategoryById.get(productId) === selectedCategoryId,
    );
    const next = moveProductWithinCategory(
      menuEditProductOrder,
      categoryProductIds,
      activeProduct.id,
      overProduct.id,
    );
    if (next === menuEditProductOrder) return true;
    dispatchMenuLayoutEditor({ type: 'SET_PRODUCT_ORDER', productOrder: next });
    const categoryOnly = next.filter(
      (productId) => productCategoryById.get(productId) === selectedCategoryId,
    );
    setMenuEditAnnouncement(
      `${activeProduct.name} moved to position ${categoryOnly.indexOf(activeProduct.id) + 1} of ${categoryOnly.length}.`,
    );
    return true;
  }

  function handleMenuEditDragOver(event: DragOverEvent): void {
    if (menuEditSaving || !menuEditActive || event.over === null) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    if (activeId === overId || lastAppliedMenuDragTargetRef.current === overId) return;
    if (applyMenuEditDragOver(activeId, overId)) {
      lastAppliedMenuDragTargetRef.current = overId;
    }
  }

  function handleMenuEditDragEnd(event: DragEndEvent): void {
    if (menuEditSaving) return;
    const activeId = String(event.active.id);
    const eventOverId = event.over === null ? null : String(event.over.id);
    const projectedKeyboardTarget = pendingKeyboardDragTargetRef.current;
    pendingKeyboardDragTargetRef.current = null;
    const overId =
      projectedKeyboardTarget !== null && (eventOverId === null || eventOverId === activeId)
        ? projectedKeyboardTarget
        : eventOverId;
    setActiveMenuDragId(null);

    if (!menuEditActive || overId === null) {
      dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
      lastAppliedMenuDragTargetRef.current = null;
      return;
    }

    if (activeId !== overId && lastAppliedMenuDragTargetRef.current !== overId) {
      applyMenuEditDragOver(activeId, overId);
    }
    lastAppliedMenuDragTargetRef.current = null;

    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    const overCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === overId,
    );
    if (activeCategory !== undefined && overCategory !== undefined) {
      if (
        menuEditSession.interaction.type !== 'CATEGORY_PICKUP' ||
        menuEditSession.interaction.categoryId !== activeCategory.id
      ) {
        dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
        return;
      }
      let categoryOrder = menuEditSession.interaction.snapshot.categoryOrder;
      if (activeCategory.id === overCategory.id && menuEditSession.draft !== null) {
        categoryOrder = menuEditSession.draft.categoryOrder;
      } else if (activeCategory.id !== overCategory.id) {
        const sourceIndex = categoryOrder.indexOf(activeCategory.id);
        const targetIndex = categoryOrder.indexOf(overCategory.id);
        if (sourceIndex < 0 || targetIndex < 0) {
          dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
          return;
        }
        const next = [...categoryOrder];
        const [moved] = next.splice(sourceIndex, 1);
        if (moved === undefined) {
          dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
          return;
        }
        next.splice(targetIndex, 0, moved);
        categoryOrder = next;
      }
      dispatchMenuLayoutEditor({
        type: 'DROP_CATEGORY_PICKUP',
        categoryId: activeCategory.id,
        categoryOrder,
      });
      return;
    }

    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    const overProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === overId,
    );
    if (
      activeProduct === undefined ||
      overProduct === undefined ||
      selectedCategoryId === null ||
      activeProduct.categoryId !== selectedCategoryId ||
      overProduct.categoryId !== selectedCategoryId ||
      menuEditSession.interaction.type !== 'PRODUCT_PICKUP' ||
      menuEditSession.interaction.productId !== activeProduct.id ||
      menuEditSession.interaction.categoryId !== selectedCategoryId
    ) {
      dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
      return;
    }

    const snapshotProductOrder = menuEditSession.interaction.snapshot.productOrder;
    let productOrder = snapshotProductOrder;
    if (activeProduct.id !== overProduct.id) {
      const productCategoryById = new Map(
        (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
      );
      const categoryProductIds = snapshotProductOrder.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      productOrder = moveProductWithinCategory(
        snapshotProductOrder,
        categoryProductIds,
        activeProduct.id,
        overProduct.id,
      );
    }
    dispatchMenuLayoutEditor({
      type: 'DROP_PRODUCT_PICKUP',
      productId: activeProduct.id,
      productOrder,
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
        {prefillConflict === null ? null : (
          <section className="orders-prefill-conflict" role="status">
            <div>
              <strong>Current order has unsaved work</strong>
              <span dir="auto">
                Choose what to do before starting an order for{' '}
                {prefillConflict.prefill.customerName}.
              </span>
            </div>
            <div className="orders-inline-actions">
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  handledPrefillRequestRef.current = prefillConflict.requestId;
                  setPrefillConflict(null);
                  onPrefillIntentHandled?.();
                }}
              >
                Keep current order
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => void startFromPrefill(prefillConflict, true)}
              >
                Start new order for <span dir="auto">{prefillConflict.prefill.customerName}</span>
              </button>
            </div>
          </section>
        )}

        {workspace.parkedDrafts.length === 0 ? null : (
          <section className="parked-orders" aria-label="Parked Orders">
            <div className="parked-orders-heading">
              <div>
                <p className="eyebrow">Business Day</p>
                <h2>Parked Orders</h2>
              </div>
              <span>{workspace.parkedDrafts.length}</span>
            </div>
            <div className="parked-orders-list">
              {workspace.parkedDrafts.map((parked) => (
                <article className="parked-order-row" key={parked.id}>
                  <div>
                    <strong dir="auto">{parked.customerName || 'Parked order'}</strong>
                    <span dir="ltr">{parked.displayPhone}</span>
                    <span>
                      {parked.lineCount} lines · {parked.totalQuantity} items
                    </span>
                  </div>
                  {restoreConflictDraftId === parked.id ? (
                    <div className="orders-inline-choice" role="status">
                      <span>Restoring this parked order would replace the current draft.</span>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => setRestoreConflictDraftId(null)}
                      >
                        Keep current order
                      </button>
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => void restoreParkedOrder(parked.id, true)}
                      >
                        Park current and Restore
                      </button>
                    </div>
                  ) : discardParkedDraftId === parked.id ? (
                    <div className="orders-inline-choice" role="status">
                      <span>Discard this parked order permanently?</span>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => setDiscardParkedDraftId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="destructive-action"
                        onClick={() => void discardParkedOrder(parked.id)}
                      >
                        Discard parked order
                      </button>
                    </div>
                  ) : (
                    <div className="orders-inline-actions">
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => {
                          if (hasMeaningfulOrderDraft(draft)) setRestoreConflictDraftId(parked.id);
                          else void restoreParkedOrder(parked.id, false);
                        }}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="quiet-action"
                        onClick={() => setDiscardParkedDraftId(parked.id)}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

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
                ref={categoryRailRef}
                className="category-rail"
                aria-label="Menu categories"
                data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}
              >
                {menuEditActive ? (
                  <DndContext
                    sensors={menuEditSensors}
                    collisionDetection={closestCenter}
                    measuring={MENU_EDIT_MEASURING}
                    onDragStart={handleMenuEditDragStart}
                    onDragOver={handleMenuEditDragOver}
                    onDragCancel={handleMenuEditDragCancel}
                    onDragEnd={handleMenuEditDragEnd}
                  >
                    <SortableContext
                      items={categorySortableIds}
                      strategy={horizontalListSortingStrategy}
                    >
                      {categoryEditorCategories.map((category) => (
                        <MenuEditCategoryTab
                          key={category.id}
                          category={category}
                          selected={selectedCategoryId === category.id}
                          disabled={menuEditSaving}
                          onSelect={() => selectMenuEditCategory(category.id)}
                          onNodeRef={(node) => setCategoryTabRef(category.id, node)}
                        />
                      ))}
                    </SortableContext>
                    <DragOverlay>
                      {activeDraggedCategory === null ? null : (
                        <div
                          aria-hidden="true"
                          className="category-tab category-tab-dragging menu-edit-drag-overlay"
                        >
                          {activeDraggedCategory.name}
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>
                ) : (
                  activeCategories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      className={[
                        'category-tab',
                        selectedCategoryId === category.id ? 'selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        setSelectedFamily(null);
                        setSearch('');
                      }}
                    >
                      {category.name}
                    </button>
                  ))
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
                        disabled={menuEditSaving}
                        aria-pressed={categoryEditAlignment === alignment}
                        onClick={() => {
                          if (menuEditSaving) return;
                          dispatchMenuLayoutEditor({
                            type: 'SET_ALIGNMENT',
                            categoryAlignment: alignment,
                          });
                        }}
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
                    disabled={!workerMenuPreferencePresentation.menuEditEnabled}
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

        {workerMenuPreferencePresentation.errorMessage === null ? null : (
          <div className="menu-edit-action-status" role="status">
            <span className="category-editor-error" role="alert">
              {workerMenuPreferencePresentation.errorMessage}
            </span>
            {workerMenuPreferencePresentation.retryVisible ? (
              <button type="button" className="text-action" onClick={retryWorkerMenuPreferenceLoad}>
                Retry
              </button>
            ) : null}
          </div>
        )}

        <div className="product-grid" aria-live="polite">
          {menuEditActive ? (
            menuEditProducts.length === 0 ? (
              <div className="menu-empty">
                <strong>No products found</strong>
                <span>This category has no active products.</span>
              </div>
            ) : (
              <DndContext
                key={selectedCategoryId ?? 'menu-products-none'}
                sensors={menuEditSensors}
                collisionDetection={closestCenter}
                measuring={MENU_EDIT_MEASURING}
                onDragStart={handleMenuEditDragStart}
                onDragOver={handleMenuEditDragOver}
                onDragCancel={handleMenuEditDragCancel}
                onDragEnd={handleMenuEditDragEnd}
              >
                <SortableContext items={productSortableIds} strategy={rectSortingStrategy}>
                  {menuEditProducts.map((product, index) => (
                    <MenuEditProductCard
                      key={product.id}
                      product={product}
                      position={index + 1}
                      total={menuEditProducts.length}
                      className="product-card menu-edit-product-card"
                      disabled={menuEditSaving}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {activeDraggedProduct === null ? null : (
                    <article
                      aria-hidden="true"
                      className="product-card menu-edit-product-card-dragging menu-edit-drag-overlay"
                    >
                      <div className="product-main">
                        <ProductCardPresentation product={activeDraggedProduct} showDescription />
                      </div>
                    </article>
                  )}
                </DragOverlay>
              </DndContext>
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
                  setCustomizer({
                    kind: 'ADD',
                    productId: product.id,
                    focusSection: 'EXTRAS',
                  })
                }
              />
            ))
          )}
        </div>

        {menuEditActive ? (
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {menuEditAnnouncement}
          </div>
        ) : null}

        {menuEditActive ? (
          <div className="menu-edit-actions" aria-label="Menu edit actions">
            <div className="menu-edit-action-status">
              {menuEditError === null ? null : (
                <span className="category-editor-error" role="alert">
                  {menuEditError}
                </span>
              )}
              <button
                type="button"
                className="text-action"
                disabled={menuEditSaving}
                onClick={resetMenuEdit}
              >
                Reset
              </button>
            </div>
            <div className="menu-edit-actions-primary">
              <button
                type="button"
                className="secondary-action"
                disabled={menuEditSaving}
                onClick={cancelMenuEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={menuEditSaving}
                onClick={() => void saveMenuEdit()}
              >
                {menuEditSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : null}
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
