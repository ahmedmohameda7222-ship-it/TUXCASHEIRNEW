import {
  addMoney,
  moneyMinor,
  parseEntityId,
  preparePaymentParts,
  type DeliveryZoneId,
  type DraftLineId,
  type EntityId,
  type MoneyMinor,
  type ModifierId,
  type OrderDraft,
  type OrderId,
  type OrderTypeId,
  type PaymentDraft,
  type ProductId,
} from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import type {
  OperationsOrdersService,
  OrdersRuntime,
  OrdersWorkspace,
  OrderPlacementResult,
  OrdersWorkspaceResult,
} from './orders';

export interface OnlineOrderAcceptanceConfirmation {
  readonly orderTypeId: OrderTypeId;
  readonly deliveryZoneId: DeliveryZoneId | null;
  readonly finalDeliveryFeeMinor: MoneyMinor | null;
  readonly payment: PaymentDraft;
}

export interface OnlineOrderAcceptanceDraftInput {
  readonly request: CachedOnlineOrderRequest;
  readonly workspace: OrdersWorkspace;
  readonly confirmation: OnlineOrderAcceptanceConfirmation;
  readonly runtime: OrdersRuntime;
}

type AcceptanceOrdersAuthority = Pick<OperationsOrdersService, 'loadWorkspace' | 'placeOrder'>;

interface TrustedModifier {
  readonly modifierId: ModifierId;
  readonly label: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
}

interface TrustedComboBeverage {
  readonly productId: ProductId;
  readonly label: string;
}

interface TrustedItem {
  readonly productId: ProductId;
  readonly productName: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
  readonly modifiers: readonly TrustedModifier[];
  readonly comboBeverage: TrustedComboBeverage | null;
  readonly note: string | null;
}

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    return fail(`${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label, true);
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(`${label} is invalid.`);
  }
  return value;
}

function trustedMoney(value: unknown, label: string): MoneyMinor {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(`${label} is invalid.`);
  }
  return moneyMinor(value);
}

function entityId<Id extends EntityId>(value: unknown, label: string): Id {
  try {
    return parseEntityId<Id>(stringValue(value, label));
  } catch {
    return fail(`${label} is invalid.`);
  }
}

function parseTrustedModifier(value: unknown, label: string): TrustedModifier {
  const source = record(value, label);
  return {
    modifierId: entityId<ModifierId>(source.modifierId, `${label} modifier`),
    label: stringValue(source.label, `${label} label`),
    unitPriceMinor: trustedMoney(source.unitPriceMinor, `${label} price`),
    quantity: positiveInteger(source.quantity, `${label} quantity`),
  };
}

function parseTrustedComboBeverage(value: unknown, label: string): TrustedComboBeverage | null {
  if (value === null) return null;
  const source = record(value, label);
  return {
    productId: entityId<ProductId>(source.productId, `${label} product`),
    label: stringValue(source.label, `${label} label`),
  };
}

function parseTrustedItem(value: unknown, index: number): TrustedItem {
  const label = `Trusted online item ${index + 1}`;
  const source = record(value, label);
  if (!Array.isArray(source.modifiers)) fail(`${label} modifiers are invalid.`);
  const modifiers = source.modifiers.map((modifier, modifierIndex) =>
    parseTrustedModifier(modifier, `${label} modifier ${modifierIndex + 1}`),
  );
  if (new Set(modifiers.map((modifier) => modifier.modifierId)).size !== modifiers.length) {
    fail(`${label} contains duplicate modifiers.`);
  }
  return {
    productId: entityId<ProductId>(source.productId, `${label} product`),
    productName: stringValue(source.productName, `${label} product name`),
    unitPriceMinor: trustedMoney(source.unitPriceMinor, `${label} product price`),
    quantity: positiveInteger(source.quantity, `${label} quantity`),
    modifiers,
    comboBeverage: parseTrustedComboBeverage(source.comboBeverage, `${label} combo beverage`),
    note: nullableString(source.note, `${label} note`),
  };
}

function assertLiveClaim(
  request: CachedOnlineOrderRequest,
  workspace: OrdersWorkspace,
  now: ReturnType<OrdersRuntime['now']>,
): asserts request is CachedOnlineOrderRequest & {
  readonly status: 'PROCESSING';
  readonly processingOrderId: string;
  readonly processingStartedAt: NonNullable<CachedOnlineOrderRequest['processingStartedAt']>;
  readonly processingExpiresAt: NonNullable<CachedOnlineOrderRequest['processingExpiresAt']>;
} {
  if (request.shopId !== workspace.shopId) {
    fail('Online-order shop authority does not match the active Operations shop.');
  }
  if (
    request.status !== 'PROCESSING' ||
    request.processingOrderId === null ||
    request.processingStartedAt === null ||
    request.processingExpiresAt === null
  ) {
    fail('A live PROCESSING online-order claim is required before acceptance.');
  }
  if (request.processingExpiresAt <= now) {
    fail('The online-order PROCESSING claim has expired and must be reclaimed.');
  }
}

function assertReservationAcceptanceOwnership(request: CachedOnlineOrderRequest): void {
  if (
    request.processingDeviceId === undefined ||
    request.processingDeviceId === null ||
    request.reservationOriginDeviceId === undefined ||
    request.reservationOriginDeviceId === null
  ) {
    fail('Online-order reservation ownership authority is unavailable; reclaim before acceptance.');
  }
  if (request.processingDeviceId !== request.reservationOriginDeviceId) {
    fail(
      'Online-order takeover claimant cannot accept a reservation owned by another origin device.',
    );
  }
}

function assertCurrentCatalogItem(
  item: TrustedItem,
  workspace: OrdersWorkspace,
): { readonly subtotalMinor: MoneyMinor } {
  const product = workspace.configuration.products.find(
    (candidate) => candidate.id === item.productId && candidate.shopId === workspace.shopId,
  );
  if (product === undefined || !product.active || product.soldOut) {
    fail('The online-order product is unavailable in the current catalog.');
  }
  if (product.priceMinor !== item.unitPriceMinor) {
    fail('The online-order product price is stale against the current catalog.');
  }

  let modifiersUnitMinor = moneyMinor(0);
  for (const modifierSnapshot of item.modifiers) {
    const modifier = workspace.configuration.modifiers.find(
      (candidate) =>
        candidate.id === modifierSnapshot.modifierId && candidate.shopId === workspace.shopId,
    );
    const link = workspace.configuration.productModifierLinks.find(
      (candidate) =>
        candidate.productId === item.productId &&
        candidate.modifierId === modifierSnapshot.modifierId &&
        candidate.shopId === workspace.shopId,
    );
    if (modifier === undefined || !modifier.active || link === undefined) {
      fail('The online-order modifier is unavailable or no longer linked in the current catalog.');
    }
    if (link.maxQuantity !== null && modifierSnapshot.quantity > link.maxQuantity) {
      fail('The online-order modifier quantity is no longer allowed by the current catalog.');
    }
    if (modifier.priceMinor !== modifierSnapshot.unitPriceMinor) {
      fail('The online-order modifier price is stale against the current catalog.');
    }
    modifiersUnitMinor = addMoney(
      modifiersUnitMinor,
      moneyMinor(modifierSnapshot.unitPriceMinor * modifierSnapshot.quantity),
    );
  }

  if (item.comboBeverage !== null) {
    if (!product.isCombo) {
      fail('The online-order combo selection is no longer valid in the current catalog.');
    }
    const beverage = workspace.configuration.products.find(
      (candidate) =>
        candidate.id === item.comboBeverage!.productId &&
        candidate.shopId === workspace.shopId &&
        candidate.active &&
        !candidate.soldOut,
    );
    const option = workspace.configuration.comboBeverageOptions.find(
      (candidate) =>
        candidate.comboProductId === item.productId &&
        candidate.beverageProductId === item.comboBeverage!.productId &&
        candidate.shopId === workspace.shopId,
    );
    if (beverage === undefined || option === undefined) {
      fail('The online-order combo beverage is unavailable in the current catalog.');
    }
  } else if (
    product.isCombo &&
    workspace.configuration.comboBeverageOptions.some(
      (candidate) => candidate.comboProductId === item.productId,
    )
  ) {
    fail('The online-order combo beverage authority is missing.');
  }

  const unitMinor = addMoney(item.unitPriceMinor, modifiersUnitMinor);
  const lineMinor = unitMinor * item.quantity;
  if (!Number.isSafeInteger(lineMinor)) fail('The online-order line subtotal overflowed.');
  return { subtotalMinor: moneyMinor(lineMinor) };
}

function assertPaymentAuthority(
  payment: PaymentDraft,
  workspace: OrdersWorkspace,
  totalMinor: MoneyMinor,
): void {
  if (payment.mode === 'NONE') fail('Worker-confirmed payment authority is required.');

  if (payment.mode === 'SINGLE') {
    const method = workspace.configuration.paymentMethods.find(
      (candidate) => candidate.id === payment.methodId && candidate.active,
    );
    if (method === undefined) fail('The worker-confirmed payment method is unavailable.');
    if (method.logicType === 'CASH' && payment.cashReceivedMinor === null) {
      fail('Worker-confirmed Cash Received is required for an online order.');
    }
  } else {
    const selected = workspace.configuration.paymentMethods.filter(
      (candidate) =>
        candidate.active &&
        (candidate.id === payment.methodAId || candidate.id === payment.methodBId),
    );
    if (selected.some((method) => method.logicType === 'CASH')) {
      fail('Split online-order cash payment requires explicit Cash Received authority.');
    }
  }

  preparePaymentParts(payment, workspace.configuration.paymentMethods, totalMinor);
}

export function prepareOnlineOrderAcceptanceDraft(
  input: OnlineOrderAcceptanceDraftInput,
): OrderDraft {
  const { request, workspace, confirmation, runtime } = input;
  assertLiveClaim(request, workspace, runtime.now());

  const orderType = workspace.configuration.orderTypes.find(
    (candidate) =>
      candidate.id === confirmation.orderTypeId &&
      candidate.shopId === workspace.shopId &&
      candidate.active,
  );
  if (orderType === undefined) fail('The worker-confirmed fulfillment type is unavailable.');
  if (request.fulfillmentPreference === 'DELIVERY' && orderType.behavior !== 'DELIVERY') {
    fail('Delivery fulfillment must be explicitly confirmed as Delivery.');
  }
  if (request.fulfillmentPreference === 'PICKUP' && orderType.behavior !== 'TAKE_AWAY') {
    fail('Pickup fulfillment must be explicitly confirmed as Take Away.');
  }

  const trustedItems = request.trustedItems.map(parseTrustedItem);
  let reconstructedSubtotalMinor = moneyMinor(0);
  const lines = trustedItems.map((item, index) => {
    const current = assertCurrentCatalogItem(item, workspace);
    reconstructedSubtotalMinor = addMoney(reconstructedSubtotalMinor, current.subtotalMinor);
    return {
      id: entityId<DraftLineId>(runtime.createUuid(), `Online-order line ${index + 1} id`),
      productId: item.productId,
      productName: item.productName,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      modifiers: item.modifiers,
      comboBeverages:
        item.comboBeverage === null
          ? []
          : Array.from({ length: item.quantity }, () => item.comboBeverage!),
      itemNote: item.note,
      addedSequence: index + 1,
    };
  });
  if (reconstructedSubtotalMinor !== request.itemsSubtotalMinor) {
    fail('The online-order trusted subtotal does not match current canonical item prices.');
  }

  let delivery: OrderDraft['delivery'];
  let deliveryFeeMinor = moneyMinor(0);
  if (request.fulfillmentPreference === 'DELIVERY') {
    if (
      request.normalizedPhone === null ||
      request.normalizedPhone.trim().length === 0 ||
      request.deliveryAddress === null ||
      request.deliveryAddress.trim().length === 0 ||
      confirmation.deliveryZoneId === null ||
      confirmation.finalDeliveryFeeMinor === null
    ) {
      fail('Worker-confirmed delivery zone and final delivery fee are required.');
    }
    const zone = workspace.configuration.deliveryZones.find(
      (candidate) =>
        candidate.id === confirmation.deliveryZoneId &&
        candidate.shopId === workspace.shopId &&
        candidate.active,
    );
    if (zone === undefined) fail('The worker-confirmed delivery zone is unavailable.');
    if (confirmation.finalDeliveryFeeMinor < 0) fail('The final delivery fee is invalid.');
    deliveryFeeMinor = confirmation.finalDeliveryFeeMinor;
    delivery = {
      displayPhone: request.normalizedPhone,
      normalizedPhone: request.normalizedPhone,
      customerName: request.customerName.trim(),
      address: request.deliveryAddress.trim(),
      zoneId: zone.id,
      zoneLabel: zone.name,
      configuredFeeMinor: zone.feeMinor,
      finalFeeMinor: confirmation.finalDeliveryFeeMinor,
    };
  } else {
    if (confirmation.deliveryZoneId !== null || confirmation.finalDeliveryFeeMinor !== null) {
      fail('Pickup fulfillment cannot invent Delivery authority.');
    }
    delivery = {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    };
  }

  const totalMinor = addMoney(reconstructedSubtotalMinor, deliveryFeeMinor);
  assertPaymentAuthority(confirmation.payment, workspace, totalMinor);

  return {
    shopId: workspace.shopId,
    businessDayId: workspace.businessDayId,
    draftScopeId: `online-order:${request.requestId}`,
    revision: 0,
    updatedAt: runtime.now(),
    checkoutIntentKey: request.requestId,
    orderTypeId: orderType.id,
    lines,
    orderNote: request.orderNote,
    discountMinor: moneyMinor(0),
    delivery,
    payment: confirmation.payment,
  };
}

export class OperationsOnlineOrderAcceptanceService {
  readonly #orders: AcceptanceOrdersAuthority;
  readonly #runtime: OrdersRuntime;

  constructor(orders: AcceptanceOrdersAuthority, runtime: OrdersRuntime) {
    this.#orders = orders;
    this.#runtime = runtime;
  }

  async accept(
    request: CachedOnlineOrderRequest,
    confirmation: OnlineOrderAcceptanceConfirmation,
  ): Promise<OrderPlacementResult> {
    if (
      request.status !== 'PROCESSING' ||
      request.processingOrderId === null ||
      request.processingStartedAt === null ||
      request.processingExpiresAt === null
    ) {
      fail('A live PROCESSING online-order claim is required before acceptance.');
    }
    if (request.processingExpiresAt <= this.#runtime.now()) {
      fail('The online-order PROCESSING claim has expired and must be reclaimed.');
    }

    const workspaceResult: OrdersWorkspaceResult = await this.#orders.loadWorkspace(
      `online-order:${request.requestId}`,
    );
    if (!workspaceResult.ok) return workspaceResult;

    const draft = prepareOnlineOrderAcceptanceDraft({
      request,
      workspace: workspaceResult.value,
      confirmation,
      runtime: this.#runtime,
    });
    assertReservationAcceptanceOwnership(request);
    const orderId = entityId<OrderId>(request.processingOrderId, 'Reserved processing order id');
    return this.#orders.placeOrder(draft, { source: 'ONLINE', orderId });
  }
}
