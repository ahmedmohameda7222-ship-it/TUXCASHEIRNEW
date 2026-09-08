import {
  OnlineOrderIntakeContractError,
  parseOnlineOrderRequestV1,
  type OnlineOrderRequestV1,
} from '../../../packages/order-intake-contracts/src/index.ts';
import { normalizeEgyptianPhone } from '../../../packages/domain/src/phone.ts';

const MAX_BODY_BYTES = 64 * 1024;

export interface OnlineOrderCatalogProduct {
  id: string;
  shopId: string;
  name: string;
  priceMinor: number;
  active: boolean;
  soldOut: boolean;
  isCombo: boolean;
}

export interface OnlineOrderCatalogModifier {
  id: string;
  shopId: string;
  name: string;
  priceMinor: number;
  active: boolean;
  standaloneProductId: string | null;
}

export interface OnlineOrderProductModifierLink {
  productId: string;
  modifierId: string;
  maxQuantity: number | null;
}

export interface OnlineOrderComboBeverageOption {
  comboProductId: string;
  beverageProductId: string;
}

export interface OnlineOrderCatalogAuthority {
  shop: { id: string; active: boolean };
  products: OnlineOrderCatalogProduct[];
  modifiers: OnlineOrderCatalogModifier[];
  productModifierLinks: OnlineOrderProductModifierLink[];
  comboBeverageOptions: OnlineOrderComboBeverageOption[];
}

export interface OnlineOrderStoredRequest {
  id: string;
  shopId: string;
  idempotencyKey: string;
  requestSha256: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export interface OnlineOrderPendingInsert {
  id: string;
  shopId: string;
  idempotencyKey: string;
  requestSha256: string;
  catalogRevision: string;
  status: 'PENDING';
  fulfillmentPreference: 'DELIVERY' | 'PICKUP';
  paymentPreference: 'CASH' | 'INSTAPAY' | 'MIXED';
  customerName: string;
  normalizedPhone: string | null;
  deliveryAddress: string | null;
  trustedItems: Array<Record<string, unknown>>;
  itemsSubtotalMinor: number;
  orderNote: string | null;
  acceptedOrderId: null;
}

export interface OnlineOrderIntakeStore {
  loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null>;
  findByIdempotency(
    shopId: string,
    idempotencyKey: string,
  ): Promise<OnlineOrderStoredRequest | null>;
  insertPending(record: OnlineOrderPendingInsert): Promise<void>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { schemaVersion: 1, error: { code } });
}

function successResponse(status: number, requestId: string): Response {
  return jsonResponse(status, { schemaVersion: 1, requestId, status: 'PENDING' });
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertTrustedMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is not a trusted non-negative safe integer`);
  }
}

function canonicalRequest(request: OnlineOrderRequestV1, normalizedPhone: string | null): unknown {
  return {
    schemaVersion: 1,
    shopId: request.shopId,
    idempotencyKey: request.idempotencyKey,
    customer: {
      name: request.customer.name,
      phone: normalizedPhone,
      address: request.customer.address,
    },
    fulfillmentPreference: request.fulfillmentPreference,
    paymentPreference: request.paymentPreference,
    items: request.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      addonProductIds: [...item.addonProductIds],
      modifierSelections: item.modifierSelections.map((selection) => ({
        modifierId: selection.modifierId,
        quantity: selection.quantity,
      })),
      comboBeverageProductId: item.comboBeverageProductId,
      note: item.note,
    })),
    orderNote: request.orderNote,
  };
}

function canonicalCatalogForRevision(catalog: OnlineOrderCatalogAuthority): unknown {
  const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    shop: catalog.shop,
    products: byId(catalog.products),
    modifiers: byId(catalog.modifiers),
    productModifierLinks: [...catalog.productModifierLinks].sort((a, b) =>
      `${a.productId}:${a.modifierId}`.localeCompare(`${b.productId}:${b.modifierId}`),
    ),
    comboBeverageOptions: [...catalog.comboBeverageOptions].sort((a, b) =>
      `${a.comboProductId}:${a.beverageProductId}`.localeCompare(
        `${b.comboProductId}:${b.beverageProductId}`,
      ),
    ),
  };
}

function validateCatalogTenant(catalog: OnlineOrderCatalogAuthority, shopId: string): void {
  if (catalog.shop.id !== shopId || !catalog.shop.active) throw new Error('catalog shop mismatch');
  if (catalog.products.some((product) => product.shopId !== shopId)) {
    throw new Error('cross-shop product authority');
  }
  if (catalog.modifiers.some((modifier) => modifier.shopId !== shopId)) {
    throw new Error('cross-shop modifier authority');
  }
  const productIds = new Set(catalog.products.map((product) => product.id));
  const modifierIds = new Set(catalog.modifiers.map((modifier) => modifier.id));
  if (
    catalog.productModifierLinks.some(
      (link) => !productIds.has(link.productId) || !modifierIds.has(link.modifierId),
    ) ||
    catalog.comboBeverageOptions.some(
      (option) => !productIds.has(option.comboProductId) || !productIds.has(option.beverageProductId),
    )
  ) {
    throw new Error('catalog relationship authority mismatch');
  }
}

function buildTrustedItems(
  request: OnlineOrderRequestV1,
  catalog: OnlineOrderCatalogAuthority,
): { trustedItems: Array<Record<string, unknown>>; itemsSubtotalMinor: number } | Response {
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const modifiers = new Map(catalog.modifiers.map((modifier) => [modifier.id, modifier]));
  const links = new Map(
    catalog.productModifierLinks.map((link) => [`${link.productId}:${link.modifierId}`, link]),
  );
  const comboOptions = new Set(
    catalog.comboBeverageOptions.map(
      (option) => `${option.comboProductId}:${option.beverageProductId}`,
    ),
  );
  const standaloneModifiers = new Map<string, OnlineOrderCatalogModifier>();
  for (const modifier of catalog.modifiers) {
    if (modifier.standaloneProductId !== null) {
      if (standaloneModifiers.has(modifier.standaloneProductId)) {
        throw new Error('ambiguous standalone modifier authority');
      }
      standaloneModifiers.set(modifier.standaloneProductId, modifier);
    }
  }

  let itemsSubtotalMinor = 0;
  const trustedItems: Array<Record<string, unknown>> = [];

  for (const item of request.items) {
    const product = products.get(item.productId);
    if (!product || !product.active || product.soldOut) {
      return errorResponse(409, 'item_unavailable');
    }
    assertTrustedMoney(product.priceMinor, 'product price');

    const trustedModifiers: Array<Record<string, unknown>> = [];
    const selectedModifierIds = new Set<string>();
    let modifiersUnitMinor = 0;

    for (const selection of item.modifierSelections) {
      const modifier = modifiers.get(selection.modifierId);
      const link = links.get(`${item.productId}:${selection.modifierId}`);
      if (
        !modifier ||
        !modifier.active ||
        !link ||
        (link.maxQuantity !== null && selection.quantity > link.maxQuantity)
      ) {
        return errorResponse(400, 'invalid_selection');
      }
      assertTrustedMoney(modifier.priceMinor, 'modifier price');
      selectedModifierIds.add(modifier.id);
      modifiersUnitMinor += modifier.priceMinor * selection.quantity;
      if (!Number.isSafeInteger(modifiersUnitMinor)) throw new Error('modifier subtotal overflow');
      trustedModifiers.push({
        modifierId: modifier.id,
        label: modifier.name,
        unitPriceMinor: modifier.priceMinor,
        quantity: selection.quantity,
      });
    }

    for (const addonProductId of item.addonProductIds) {
      const addonProduct = products.get(addonProductId);
      const modifier = standaloneModifiers.get(addonProductId);
      if (
        !addonProduct ||
        !addonProduct.active ||
        addonProduct.soldOut ||
        !modifier ||
        !modifier.active ||
        selectedModifierIds.has(modifier.id)
      ) {
        return errorResponse(400, 'invalid_selection');
      }
      const link = links.get(`${item.productId}:${modifier.id}`);
      if (!link || (link.maxQuantity !== null && link.maxQuantity < 1)) {
        return errorResponse(400, 'invalid_selection');
      }
      assertTrustedMoney(modifier.priceMinor, 'addon modifier price');
      selectedModifierIds.add(modifier.id);
      modifiersUnitMinor += modifier.priceMinor;
      if (!Number.isSafeInteger(modifiersUnitMinor)) throw new Error('addon subtotal overflow');
      trustedModifiers.push({
        modifierId: modifier.id,
        label: modifier.name,
        unitPriceMinor: modifier.priceMinor,
        quantity: 1,
      });
    }

    let comboBeverage: Record<string, unknown> | null = null;
    if (item.comboBeverageProductId !== null) {
      if (!product.isCombo) return errorResponse(400, 'invalid_selection');
      const beverage = products.get(item.comboBeverageProductId);
      if (
        !beverage ||
        !beverage.active ||
        beverage.soldOut ||
        !comboOptions.has(`${item.productId}:${item.comboBeverageProductId}`)
      ) {
        return errorResponse(400, 'invalid_selection');
      }
      comboBeverage = { productId: beverage.id, label: beverage.name };
    } else if (
      product.isCombo &&
      catalog.comboBeverageOptions.some((option) => option.comboProductId === product.id)
    ) {
      return errorResponse(400, 'invalid_selection');
    }

    const unitConfiguredMinor = product.priceMinor + modifiersUnitMinor;
    const lineMinor = unitConfiguredMinor * item.quantity;
    if (!Number.isSafeInteger(unitConfiguredMinor) || !Number.isSafeInteger(lineMinor)) {
      throw new Error('line subtotal overflow');
    }
    itemsSubtotalMinor += lineMinor;
    if (!Number.isSafeInteger(itemsSubtotalMinor)) throw new Error('order subtotal overflow');

    trustedItems.push({
      productId: product.id,
      productName: product.name,
      unitPriceMinor: product.priceMinor,
      quantity: item.quantity,
      modifiers: trustedModifiers,
      comboBeverage,
      note: item.note,
    });
  }

  return { trustedItems, itemsSubtotalMinor };
}

export async function handleOrderIntakeRequest(
  httpRequest: Request,
  store: OnlineOrderIntakeStore,
): Promise<Response> {
  if (httpRequest.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }
  if (httpRequest.method !== 'POST') return errorResponse(405, 'method_not_allowed');

  const declaredLength = Number(httpRequest.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'payload_too_large');
  }

  let parsed: OnlineOrderRequestV1;
  try {
    const rawBody = await httpRequest.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'payload_too_large');
    }
    parsed = parseOnlineOrderRequestV1(JSON.parse(rawBody));
  } catch (error) {
    if (error instanceof OnlineOrderIntakeContractError || error instanceof SyntaxError) {
      return errorResponse(400, 'invalid_request');
    }
    console.error('order-intake request parse failed', error instanceof Error ? error.name : 'Error');
    return errorResponse(500, 'intake_failed');
  }

  let normalizedPhone: string | null = null;
  if (parsed.customer.phone !== null) {
    const phone = normalizeEgyptianPhone(parsed.customer.phone);
    if (!phone.valid) return errorResponse(400, 'invalid_phone');
    normalizedPhone = phone.normalizedPhone;
  }

  const requestSha256 = await sha256Hex(canonicalRequest(parsed, normalizedPhone));
  try {
    const existing = await store.findByIdempotency(parsed.shopId, parsed.idempotencyKey);
    if (existing) {
      if (existing.requestSha256 !== requestSha256) {
        return errorResponse(409, 'idempotency_conflict');
      }
      if (existing.status !== 'PENDING') return errorResponse(409, 'request_resolved');
      return successResponse(200, existing.id);
    }

    const catalog = await store.loadCatalog(parsed.shopId);
    if (!catalog || !catalog.shop.active) return errorResponse(404, 'shop_not_found');
    validateCatalogTenant(catalog, parsed.shopId);

    const trusted = buildTrustedItems(parsed, catalog);
    if (trusted instanceof Response) return trusted;
    const catalogRevision = await sha256Hex(canonicalCatalogForRevision(catalog));
    const record: OnlineOrderPendingInsert = {
      id: crypto.randomUUID(),
      shopId: parsed.shopId,
      idempotencyKey: parsed.idempotencyKey,
      requestSha256,
      catalogRevision,
      status: 'PENDING',
      fulfillmentPreference: parsed.fulfillmentPreference,
      paymentPreference: parsed.paymentPreference,
      customerName: parsed.customer.name,
      normalizedPhone,
      deliveryAddress: parsed.customer.address,
      trustedItems: trusted.trustedItems,
      itemsSubtotalMinor: trusted.itemsSubtotalMinor,
      orderNote: parsed.orderNote,
      acceptedOrderId: null,
    };

    try {
      await store.insertPending(record);
    } catch {
      const raced = await store.findByIdempotency(parsed.shopId, parsed.idempotencyKey);
      if (raced?.requestSha256 === requestSha256 && raced.status === 'PENDING') {
        return successResponse(200, raced.id);
      }
      if (raced) return errorResponse(409, 'idempotency_conflict');
      throw new Error('pending insert failed');
    }
    return successResponse(202, record.id);
  } catch (error) {
    console.error('order-intake failed', error instanceof Error ? error.name : 'Error');
    return errorResponse(500, 'intake_failed');
  }
}
