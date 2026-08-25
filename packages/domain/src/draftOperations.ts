import type { DeliveryZone, OperationsConfigurationSnapshot, Product } from './catalog';
import { DomainInvariantError } from './errors';
import type { DraftLineId, ProductId } from './ids';
import type {
  DraftLineCustomization,
  DraftModifierSelection,
  DraftOrderLine,
  OrderDraft,
} from './orderDraft';
import type { ComboBeverageSnapshot, OrderModifierSnapshot } from './models';

function sameModifiers(
  left: readonly OrderModifierSnapshot[],
  right: readonly OrderModifierSnapshot[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((modifier, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      modifier.modifierId === other.modifierId &&
      modifier.quantity === other.quantity &&
      modifier.unitPriceMinor === other.unitPriceMinor
    );
  });
}

function buildModifierSnapshots(
  product: Product,
  selections: readonly DraftModifierSelection[],
  configuration: OperationsConfigurationSnapshot,
): readonly OrderModifierSnapshot[] {
  const links = configuration.productModifierLinks
    .filter((link) => link.productId === product.id)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const linkByModifier = new Map(links.map((link) => [link.modifierId, link] as const));

  return selections
    .filter((selection) => selection.quantity > 0)
    .map((selection) => {
      if (!Number.isSafeInteger(selection.quantity) || selection.quantity <= 0) {
        throw new DomainInvariantError('Modifier quantity must be a positive safe integer.');
      }
      const link = linkByModifier.get(selection.modifierId);
      if (link === undefined) {
        throw new DomainInvariantError('Selected modifier is not allowed for this product.');
      }
      if (link.maxQuantity !== null && selection.quantity > link.maxQuantity) {
        throw new DomainInvariantError(
          'Selected modifier quantity exceeds its configured maximum.',
        );
      }
      const modifier = configuration.modifiers.find(
        (candidate) => candidate.id === selection.modifierId && candidate.active,
      );
      if (modifier === undefined) {
        throw new DomainInvariantError('Selected modifier is unavailable.');
      }
      return {
        modifierId: modifier.id,
        label: modifier.name,
        unitPriceMinor: modifier.priceMinor,
        quantity: selection.quantity,
      };
    })
    .sort((left, right) => {
      const leftOrder = linkByModifier.get(left.modifierId)?.sortOrder ?? 0;
      const rightOrder = linkByModifier.get(right.modifierId)?.sortOrder ?? 0;
      return leftOrder - rightOrder;
    });
}

function buildComboBeverageSnapshots(
  product: Product,
  beverageProductIds: readonly ProductId[],
  requiredCount: number,
  configuration: OperationsConfigurationSnapshot,
): readonly ComboBeverageSnapshot[] {
  if (!product.isCombo) {
    if (beverageProductIds.length > 0) {
      throw new DomainInvariantError('Non-combo products cannot carry combo beverage selections.');
    }
    return [];
  }
  if (beverageProductIds.length !== requiredCount) {
    throw new DomainInvariantError('Each combo unit requires one included beverage selection.');
  }

  const allowed = new Set(
    configuration.comboBeverageOptions
      .filter((option) => option.comboProductId === product.id)
      .map((option) => option.beverageProductId),
  );
  return beverageProductIds.map((beverageProductId) => {
    if (!allowed.has(beverageProductId)) {
      throw new DomainInvariantError('Selected beverage is not allowed for this combo.');
    }
    const beverage = configuration.products.find(
      (candidate) => candidate.id === beverageProductId && candidate.active && !candidate.soldOut,
    );
    if (beverage === undefined) {
      throw new DomainInvariantError('Selected combo beverage is unavailable.');
    }
    return { productId: beverage.id, label: beverage.name };
  });
}

function resolveProduct(
  configuration: OperationsConfigurationSnapshot,
  productId: ProductId,
): Product {
  const product = configuration.products.find((candidate) => candidate.id === productId);
  if (product === undefined || !product.active) {
    throw new DomainInvariantError('Product is unavailable.');
  }
  return product;
}

export function productQuantityInDraft(draft: OrderDraft, productId: ProductId): number {
  return draft.lines
    .filter((line) => line.productId === productId)
    .reduce((total, line) => total + line.quantity, 0);
}

export function addProductUnit(input: {
  readonly draft: OrderDraft;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly productId: ProductId;
  readonly lineId: DraftLineId;
  readonly addedSequence: number;
  readonly customization?: DraftLineCustomization;
}): OrderDraft {
  if (!Number.isSafeInteger(input.addedSequence) || input.addedSequence <= 0) {
    throw new DomainInvariantError('Draft addition sequence must be a positive safe integer.');
  }
  const product = resolveProduct(input.configuration, input.productId);
  if (product.soldOut) {
    throw new DomainInvariantError('Sold Out products cannot receive new draft units.');
  }

  const customization = input.customization ?? {
    modifiers: [],
    comboBeverageProductIds: [],
    itemNote: null,
  };
  const modifiers = buildModifierSnapshots(product, customization.modifiers, input.configuration);
  const comboBeverages = buildComboBeverageSnapshots(
    product,
    customization.comboBeverageProductIds,
    1,
    input.configuration,
  );
  const itemNote = customization.itemNote?.trim() || null;

  if (!product.isCombo) {
    const mergeIndex = input.draft.lines.findIndex(
      (line) =>
        line.productId === product.id &&
        line.unitPriceMinor === product.priceMinor &&
        line.itemNote === itemNote &&
        line.comboBeverages.length === 0 &&
        sameModifiers(line.modifiers, modifiers),
    );
    if (mergeIndex >= 0) {
      const existing = input.draft.lines[mergeIndex];
      if (existing === undefined) return input.draft;
      const quantity = existing.quantity + 1;
      if (!Number.isSafeInteger(quantity)) {
        throw new DomainInvariantError('Draft quantity overflowed its safe integer range.');
      }
      const lines = [...input.draft.lines];
      lines[mergeIndex] = { ...existing, quantity, addedSequence: input.addedSequence };
      return { ...input.draft, lines };
    }
  }

  const line: DraftOrderLine = {
    id: input.lineId,
    productId: product.id,
    productName: product.name,
    unitPriceMinor: product.priceMinor,
    quantity: 1,
    modifiers,
    comboBeverages,
    itemNote,
    addedSequence: input.addedSequence,
  };
  return { ...input.draft, lines: [...input.draft.lines, line] };
}

export function duplicateDraftLineUnit(input: {
  readonly draft: OrderDraft;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly lineId: DraftLineId;
  readonly newLineId: DraftLineId;
  readonly addedSequence: number;
}): OrderDraft {
  const line = input.draft.lines.find((candidate) => candidate.id === input.lineId);
  if (line === undefined) {
    throw new DomainInvariantError('Draft line was not found.');
  }

  const customization: DraftLineCustomization = {
    modifiers: line.modifiers.map((modifier) => ({
      modifierId: modifier.modifierId,
      quantity: modifier.quantity,
    })),
    comboBeverageProductIds: line.comboBeverages.map((beverage) => beverage.productId),
    itemNote: line.itemNote,
  };

  return addProductUnit({
    draft: input.draft,
    configuration: input.configuration,
    productId: line.productId,
    lineId: input.newLineId,
    addedSequence: input.addedSequence,
    customization,
  });
}

export function decrementProductUnit(draft: OrderDraft, productId: ProductId): OrderDraft {
  const candidates = draft.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.productId === productId)
    .sort((left, right) => right.line.addedSequence - left.line.addedSequence);
  const target = candidates[0];
  if (target === undefined) return draft;
  return decrementDraftLine(draft, target.line.id);
}

export function decrementDraftLine(draft: OrderDraft, lineId: DraftLineId): OrderDraft {
  const index = draft.lines.findIndex((line) => line.id === lineId);
  if (index < 0) return draft;
  const line = draft.lines[index];
  if (line === undefined) return draft;
  if (line.quantity === 1) {
    return { ...draft, lines: draft.lines.filter((candidate) => candidate.id !== lineId) };
  }

  const lines = [...draft.lines];
  lines[index] = {
    ...line,
    quantity: line.quantity - 1,
    comboBeverages:
      line.comboBeverages.length === line.quantity
        ? line.comboBeverages.slice(0, -1)
        : line.comboBeverages,
  };
  return { ...draft, lines };
}

export function replaceDraftLineCustomization(input: {
  readonly draft: OrderDraft;
  readonly lineId: DraftLineId;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly customization: DraftLineCustomization;
}): OrderDraft {
  const index = input.draft.lines.findIndex((line) => line.id === input.lineId);
  if (index < 0) {
    throw new DomainInvariantError('Draft line was not found.');
  }
  const line = input.draft.lines[index];
  if (line === undefined) return input.draft;
  const product = resolveProduct(input.configuration, line.productId);
  const lines = [...input.draft.lines];
  lines[index] = {
    ...line,
    modifiers: buildModifierSnapshots(product, input.customization.modifiers, input.configuration),
    comboBeverages: buildComboBeverageSnapshots(
      product,
      input.customization.comboBeverageProductIds,
      line.quantity,
      input.configuration,
    ),
    itemNote: input.customization.itemNote?.trim() || null,
  };
  return { ...input.draft, lines };
}

export function applyDeliveryZone(draft: OrderDraft, zone: DeliveryZone): OrderDraft {
  return {
    ...draft,
    delivery: {
      ...draft.delivery,
      zoneId: zone.id,
      zoneLabel: zone.name,
      configuredFeeMinor: zone.feeMinor,
      finalFeeMinor: zone.feeMinor,
    },
  };
}
