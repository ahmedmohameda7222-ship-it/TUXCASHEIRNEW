export const CATALOG_SCHEMA_VERSION = 1 as const;

export class CatalogContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogContractError';
  }
}

export interface PublicCatalogCategoryV1 {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface PublicCatalogProductV1 {
  readonly id: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly imageUrl: string | null;
  readonly bestSeller: boolean;
  readonly active: boolean;
  readonly soldOut: boolean;
  readonly isCombo: boolean;
  readonly sortOrder: number;
}

export interface PublicCatalogModifierV1 {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface PublicProductModifierLinkV1 {
  readonly productId: string;
  readonly modifierId: string;
  readonly maxQuantity: number | null;
  readonly sortOrder: number;
}

export interface PublicComboBeverageOptionV1 {
  readonly comboProductId: string;
  readonly beverageProductId: string;
  readonly sortOrder: number;
}

export interface PublicCatalogSnapshotV1 {
  readonly schemaVersion: 1;
  readonly shopId: string;
  readonly revision: string;
  readonly categories: readonly PublicCatalogCategoryV1[];
  readonly products: readonly PublicCatalogProductV1[];
  readonly modifiers: readonly PublicCatalogModifierV1[];
  readonly productModifierLinks: readonly PublicProductModifierLinkV1[];
  readonly comboBeverageOptions: readonly PublicComboBeverageOptionV1[];
}

export const CATALOG_ERROR_CODES = [
  'invalid_shop_id',
  'shop_not_found',
  'catalog_unavailable',
  'catalog_read_failed',
  'method_not_allowed',
  'invalid_request',
  'authentication_required',
  'invalid_identity',
  'membership_required',
  'membership_inactive',
  'role_forbidden',
  'entity_not_found',
  'cross_shop_forbidden',
  'image_key_forbidden',
  'command_conflict',
  'command_failed',
  'storage_failed',
] as const;

export type CatalogErrorCodeV1 = (typeof CATALOG_ERROR_CODES)[number];

export interface CatalogErrorV1 {
  readonly schemaVersion: 1;
  readonly error: {
    readonly code: CatalogErrorCodeV1;
  };
}

export interface AdminCategoryInputV1 {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface AdminProductInputV1 {
  readonly id: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly imageKey: string | null;
  readonly bestSeller: boolean;
  readonly active: boolean;
  readonly soldOut: boolean;
  readonly isCombo: boolean;
  readonly sortOrder: number;
}

export interface AdminModifierInputV1 {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly active: boolean;
  readonly sortOrder: number;
}

export type CatalogAdminCommandPayloadV1 =
  | { readonly type: 'category.create'; readonly category: AdminCategoryInputV1 }
  | {
      readonly type: 'category.update';
      readonly categoryId: string;
      readonly patch: Partial<Omit<AdminCategoryInputV1, 'id'>>;
    }
  | { readonly type: 'category.retire'; readonly categoryId: string }
  | { readonly type: 'category.reorder'; readonly categoryId: string; readonly sortOrder: number }
  | { readonly type: 'product.create'; readonly product: AdminProductInputV1 }
  | {
      readonly type: 'product.update';
      readonly productId: string;
      readonly patch: Partial<Omit<AdminProductInputV1, 'id' | 'categoryId' | 'imageKey'>>;
    }
  | { readonly type: 'product.retire'; readonly productId: string }
  | { readonly type: 'product.move'; readonly productId: string; readonly categoryId: string }
  | { readonly type: 'product.reorder'; readonly productId: string; readonly sortOrder: number }
  | { readonly type: 'modifier.create'; readonly modifier: AdminModifierInputV1 }
  | {
      readonly type: 'modifier.update';
      readonly modifierId: string;
      readonly patch: Partial<Omit<AdminModifierInputV1, 'id'>>;
    }
  | { readonly type: 'modifier.retire'; readonly modifierId: string }
  | {
      readonly type: 'product_modifier_link.set';
      readonly productId: string;
      readonly modifierId: string;
      readonly maxQuantity: number | null;
      readonly sortOrder: number;
    }
  | {
      readonly type: 'product_modifier_link.remove';
      readonly productId: string;
      readonly modifierId: string;
    }
  | {
      readonly type: 'combo_beverage_option.set';
      readonly comboProductId: string;
      readonly beverageProductId: string;
      readonly sortOrder: number;
    }
  | {
      readonly type: 'combo_beverage_option.remove';
      readonly comboProductId: string;
      readonly beverageProductId: string;
    }
  | {
      readonly type: 'image.prepare';
      readonly productId: string;
      readonly fileExtension: string;
      readonly contentType: string;
    }
  | { readonly type: 'image.replace'; readonly productId: string; readonly imageKey: string }
  | { readonly type: 'image.remove'; readonly productId: string };

export interface CatalogAdminCommandV1 {
  readonly schemaVersion: 1;
  readonly shopId: string;
  readonly commandId: string;
  readonly command: CatalogAdminCommandPayloadV1;
}

export interface CatalogAdminSuccessV1 {
  readonly schemaVersion: 1;
  readonly commandId: string;
  readonly ok: true;
  readonly result: Readonly<Record<string, unknown>>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_PATTERN = /^[0-9a-f]{64}$/;
const IMAGE_KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,8}$/i;
const FILE_EXTENSION_PATTERN = /^[a-z0-9]{2,8}$/;
const CONTENT_TYPE_PATTERN = /^image\/(?:png|jpeg|webp|avif)$/;

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogContractError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) throw new CatalogContractError(`${path} has unexpected field ${key}`);
  }
}

function requiredUuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new CatalogContractError(`${path} must be a valid UUID`);
  }
  return value.toLowerCase();
}

function requiredSlug(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SLUG_PATTERN.test(value)) {
    throw new CatalogContractError(`${path} must be a stable lowercase slug`);
  }
  return value;
}

function requiredText(value: unknown, path: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new CatalogContractError(`${path} must be a non-empty string`);
  }
  return value;
}

function nullableText(value: unknown, path: string, max = 2000): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new CatalogContractError(`${path} must be a string or null`);
  }
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new CatalogContractError(`${path} must be boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CatalogContractError(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveIntegerOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CatalogContractError(`${path} must be a positive safe integer or null`);
  }
  return value as number;
}

function nullableUrl(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string')
    throw new CatalogContractError(`${path} must be URL string or null`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CatalogContractError(`${path} must be URL string or null`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CatalogContractError(`${path} must use http or https`);
  }
  return value;
}

function parseCategory(value: unknown, path: string): PublicCatalogCategoryV1 {
  const row = asObject(value, path);
  exactKeys(row, ['id', 'slug', 'name', 'description', 'active', 'sortOrder'], path);
  return {
    id: requiredUuid(row.id, `${path}.id`),
    slug: requiredSlug(row.slug, `${path}.slug`),
    name: requiredText(row.name, `${path}.name`, 200),
    description: nullableText(row.description, `${path}.description`),
    active: requiredBoolean(row.active, `${path}.active`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseProduct(value: unknown, path: string): PublicCatalogProductV1 {
  const row = asObject(value, path);
  exactKeys(
    row,
    [
      'id',
      'slug',
      'categoryId',
      'name',
      'description',
      'priceMinor',
      'imageUrl',
      'bestSeller',
      'active',
      'soldOut',
      'isCombo',
      'sortOrder',
    ],
    path,
  );
  return {
    id: requiredUuid(row.id, `${path}.id`),
    slug: requiredSlug(row.slug, `${path}.slug`),
    categoryId: requiredUuid(row.categoryId, `${path}.categoryId`),
    name: requiredText(row.name, `${path}.name`, 200),
    description: nullableText(row.description, `${path}.description`),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    imageUrl: nullableUrl(row.imageUrl, `${path}.imageUrl`),
    bestSeller: requiredBoolean(row.bestSeller, `${path}.bestSeller`),
    active: requiredBoolean(row.active, `${path}.active`),
    soldOut: requiredBoolean(row.soldOut, `${path}.soldOut`),
    isCombo: requiredBoolean(row.isCombo, `${path}.isCombo`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseModifier(value: unknown, path: string): PublicCatalogModifierV1 {
  const row = asObject(value, path);
  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);
  return {
    id: requiredUuid(row.id, `${path}.id`),
    name: requiredText(row.name, `${path}.name`, 200),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    active: requiredBoolean(row.active, `${path}.active`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseProductModifierLink(value: unknown, path: string): PublicProductModifierLinkV1 {
  const row = asObject(value, path);
  exactKeys(row, ['productId', 'modifierId', 'maxQuantity', 'sortOrder'], path);
  return {
    productId: requiredUuid(row.productId, `${path}.productId`),
    modifierId: requiredUuid(row.modifierId, `${path}.modifierId`),
    maxQuantity: positiveIntegerOrNull(row.maxQuantity, `${path}.maxQuantity`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseComboOption(value: unknown, path: string): PublicComboBeverageOptionV1 {
  const row = asObject(value, path);
  exactKeys(row, ['comboProductId', 'beverageProductId', 'sortOrder'], path);
  return {
    comboProductId: requiredUuid(row.comboProductId, `${path}.comboProductId`),
    beverageProductId: requiredUuid(row.beverageProductId, `${path}.beverageProductId`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseArray<T>(
  value: unknown,
  path: string,
  parser: (value: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new CatalogContractError(`${path} must be an array`);
  return value.map((entry, index) => parser(entry, `${path}[${index}]`));
}

export function parsePublicCatalogSnapshotV1(value: unknown): PublicCatalogSnapshotV1 {
  const root = asObject(value, 'snapshot');
  exactKeys(
    root,
    [
      'schemaVersion',
      'shopId',
      'revision',
      'categories',
      'products',
      'modifiers',
      'productModifierLinks',
      'comboBeverageOptions',
    ],
    'snapshot',
  );
  if (root.schemaVersion !== 1) throw new CatalogContractError('snapshot.schemaVersion must be 1');
  if (typeof root.revision !== 'string' || !REVISION_PATTERN.test(root.revision)) {
    throw new CatalogContractError('snapshot.revision must be a lowercase SHA-256 hex digest');
  }
  return {
    schemaVersion: 1,
    shopId: requiredUuid(root.shopId, 'snapshot.shopId'),
    revision: root.revision,
    categories: parseArray(root.categories, 'snapshot.categories', parseCategory),
    products: parseArray(root.products, 'snapshot.products', parseProduct),
    modifiers: parseArray(root.modifiers, 'snapshot.modifiers', parseModifier),
    productModifierLinks: parseArray(
      root.productModifierLinks,
      'snapshot.productModifierLinks',
      parseProductModifierLink,
    ),
    comboBeverageOptions: parseArray(
      root.comboBeverageOptions,
      'snapshot.comboBeverageOptions',
      parseComboOption,
    ),
  };
}

export function parseCatalogErrorV1(value: unknown): CatalogErrorV1 {
  const root = asObject(value, 'response');
  exactKeys(root, ['schemaVersion', 'error'], 'response');
  if (root.schemaVersion !== 1) throw new CatalogContractError('response.schemaVersion must be 1');
  const error = asObject(root.error, 'response.error');
  exactKeys(error, ['code'], 'response.error');
  if (
    typeof error.code !== 'string' ||
    !CATALOG_ERROR_CODES.includes(error.code as CatalogErrorCodeV1)
  ) {
    throw new CatalogContractError('response.error.code is not a supported catalog error code');
  }
  return { schemaVersion: 1, error: { code: error.code as CatalogErrorCodeV1 } };
}

function parseAdminCategory(value: unknown, path: string): AdminCategoryInputV1 {
  return parseCategory(value, path);
}

function parseAdminProduct(value: unknown, path: string): AdminProductInputV1 {
  const row = asObject(value, path);
  exactKeys(
    row,
    [
      'id',
      'categoryId',
      'slug',
      'name',
      'description',
      'priceMinor',
      'imageKey',
      'bestSeller',
      'active',
      'soldOut',
      'isCombo',
      'sortOrder',
    ],
    path,
  );
  if (
    row.imageKey !== null &&
    (typeof row.imageKey !== 'string' || !IMAGE_KEY_PATTERN.test(row.imageKey))
  ) {
    throw new CatalogContractError(
      `${path}.imageKey must be a canonical shop-scoped image key or null`,
    );
  }
  return {
    id: requiredUuid(row.id, `${path}.id`),
    categoryId: requiredUuid(row.categoryId, `${path}.categoryId`),
    slug: requiredSlug(row.slug, `${path}.slug`),
    name: requiredText(row.name, `${path}.name`, 200),
    description: nullableText(row.description, `${path}.description`),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    imageKey: row.imageKey as string | null,
    bestSeller: requiredBoolean(row.bestSeller, `${path}.bestSeller`),
    active: requiredBoolean(row.active, `${path}.active`),
    soldOut: requiredBoolean(row.soldOut, `${path}.soldOut`),
    isCombo: requiredBoolean(row.isCombo, `${path}.isCombo`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parseAdminModifier(value: unknown, path: string): AdminModifierInputV1 {
  const row = asObject(value, path);
  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);
  return {
    id: requiredUuid(row.id, `${path}.id`),
    name: requiredText(row.name, `${path}.name`, 200),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    active: requiredBoolean(row.active, `${path}.active`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };
}

function parsePatch(
  value: unknown,
  path: string,
  parsers: Readonly<Record<string, (value: unknown, path: string) => unknown>>,
): Record<string, unknown> {
  const row = asObject(value, path);
  exactKeys(row, Object.keys(parsers), path);
  if (Object.keys(row).length === 0) throw new CatalogContractError(`${path} must not be empty`);
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(row)) output[key] = parsers[key]!(raw, `${path}.${key}`);
  return output;
}

function parseCommand(value: unknown): CatalogAdminCommandPayloadV1 {
  const command = asObject(value, 'request.command');
  const type = command.type;
  if (typeof type !== 'string')
    throw new CatalogContractError('request.command.type must be a string');

  switch (type) {
    case 'category.create':
      exactKeys(command, ['type', 'category'], 'request.command');
      return { type, category: parseAdminCategory(command.category, 'request.command.category') };
    case 'category.update':
      exactKeys(command, ['type', 'categoryId', 'patch'], 'request.command');
      return {
        type,
        categoryId: requiredUuid(command.categoryId, 'request.command.categoryId'),
        patch: parsePatch(command.patch, 'request.command.patch', {
          slug: requiredSlug,
          name: (v, p) => requiredText(v, p, 200),
          description: nullableText,
          active: requiredBoolean,
          sortOrder: nonNegativeInteger,
        }),
      } as CatalogAdminCommandPayloadV1;
    case 'category.retire':
      exactKeys(command, ['type', 'categoryId'], 'request.command');
      return { type, categoryId: requiredUuid(command.categoryId, 'request.command.categoryId') };
    case 'category.reorder':
      exactKeys(command, ['type', 'categoryId', 'sortOrder'], 'request.command');
      return {
        type,
        categoryId: requiredUuid(command.categoryId, 'request.command.categoryId'),
        sortOrder: nonNegativeInteger(command.sortOrder, 'request.command.sortOrder'),
      };
    case 'product.create':
      exactKeys(command, ['type', 'product'], 'request.command');
      return { type, product: parseAdminProduct(command.product, 'request.command.product') };
    case 'product.update':
      exactKeys(command, ['type', 'productId', 'patch'], 'request.command');
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        patch: parsePatch(command.patch, 'request.command.patch', {
          slug: requiredSlug,
          name: (v, p) => requiredText(v, p, 200),
          description: nullableText,
          priceMinor: nonNegativeInteger,
          bestSeller: requiredBoolean,
          active: requiredBoolean,
          soldOut: requiredBoolean,
          isCombo: requiredBoolean,
          sortOrder: nonNegativeInteger,
        }),
      } as CatalogAdminCommandPayloadV1;
    case 'product.retire':
      exactKeys(command, ['type', 'productId'], 'request.command');
      return { type, productId: requiredUuid(command.productId, 'request.command.productId') };
    case 'product.move':
      exactKeys(command, ['type', 'productId', 'categoryId'], 'request.command');
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        categoryId: requiredUuid(command.categoryId, 'request.command.categoryId'),
      };
    case 'product.reorder':
      exactKeys(command, ['type', 'productId', 'sortOrder'], 'request.command');
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        sortOrder: nonNegativeInteger(command.sortOrder, 'request.command.sortOrder'),
      };
    case 'modifier.create':
      exactKeys(command, ['type', 'modifier'], 'request.command');
      return { type, modifier: parseAdminModifier(command.modifier, 'request.command.modifier') };
    case 'modifier.update':
      exactKeys(command, ['type', 'modifierId', 'patch'], 'request.command');
      return {
        type,
        modifierId: requiredUuid(command.modifierId, 'request.command.modifierId'),
        patch: parsePatch(command.patch, 'request.command.patch', {
          name: (v, p) => requiredText(v, p, 200),
          priceMinor: nonNegativeInteger,
          active: requiredBoolean,
          sortOrder: nonNegativeInteger,
        }),
      } as CatalogAdminCommandPayloadV1;
    case 'modifier.retire':
      exactKeys(command, ['type', 'modifierId'], 'request.command');
      return { type, modifierId: requiredUuid(command.modifierId, 'request.command.modifierId') };
    case 'product_modifier_link.set':
      exactKeys(
        command,
        ['type', 'productId', 'modifierId', 'maxQuantity', 'sortOrder'],
        'request.command',
      );
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        modifierId: requiredUuid(command.modifierId, 'request.command.modifierId'),
        maxQuantity: positiveIntegerOrNull(command.maxQuantity, 'request.command.maxQuantity'),
        sortOrder: nonNegativeInteger(command.sortOrder, 'request.command.sortOrder'),
      };
    case 'product_modifier_link.remove':
      exactKeys(command, ['type', 'productId', 'modifierId'], 'request.command');
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        modifierId: requiredUuid(command.modifierId, 'request.command.modifierId'),
      };
    case 'combo_beverage_option.set':
      exactKeys(
        command,
        ['type', 'comboProductId', 'beverageProductId', 'sortOrder'],
        'request.command',
      );
      return {
        type,
        comboProductId: requiredUuid(command.comboProductId, 'request.command.comboProductId'),
        beverageProductId: requiredUuid(
          command.beverageProductId,
          'request.command.beverageProductId',
        ),
        sortOrder: nonNegativeInteger(command.sortOrder, 'request.command.sortOrder'),
      };
    case 'combo_beverage_option.remove':
      exactKeys(command, ['type', 'comboProductId', 'beverageProductId'], 'request.command');
      return {
        type,
        comboProductId: requiredUuid(command.comboProductId, 'request.command.comboProductId'),
        beverageProductId: requiredUuid(
          command.beverageProductId,
          'request.command.beverageProductId',
        ),
      };
    case 'image.prepare': {
      exactKeys(command, ['type', 'productId', 'fileExtension', 'contentType'], 'request.command');
      const fileExtension =
        typeof command.fileExtension === 'string' ? command.fileExtension.toLowerCase() : '';
      if (!FILE_EXTENSION_PATTERN.test(fileExtension))
        throw new CatalogContractError('request.command.fileExtension is invalid');
      if (
        typeof command.contentType !== 'string' ||
        !CONTENT_TYPE_PATTERN.test(command.contentType)
      ) {
        throw new CatalogContractError(
          'request.command.contentType must be an approved image MIME type',
        );
      }
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        fileExtension,
        contentType: command.contentType,
      };
    }
    case 'image.replace':
      exactKeys(command, ['type', 'productId', 'imageKey'], 'request.command');
      if (typeof command.imageKey !== 'string' || !IMAGE_KEY_PATTERN.test(command.imageKey)) {
        throw new CatalogContractError('request.command.imageKey must be a canonical image key');
      }
      return {
        type,
        productId: requiredUuid(command.productId, 'request.command.productId'),
        imageKey: command.imageKey,
      };
    case 'image.remove':
      exactKeys(command, ['type', 'productId'], 'request.command');
      return { type, productId: requiredUuid(command.productId, 'request.command.productId') };
    default:
      throw new CatalogContractError('request.command.type is not supported by schemaVersion 1');
  }
}

export function parseCatalogAdminCommandV1(value: unknown): CatalogAdminCommandV1 {
  const root = asObject(value, 'request');
  exactKeys(root, ['schemaVersion', 'shopId', 'commandId', 'command'], 'request');
  if (root.schemaVersion !== 1) throw new CatalogContractError('request.schemaVersion must be 1');
  return {
    schemaVersion: 1,
    shopId: requiredUuid(root.shopId, 'request.shopId'),
    commandId: requiredUuid(root.commandId, 'request.commandId'),
    command: parseCommand(root.command),
  };
}

export function isCanonicalUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isShopScopedImageKey(shopId: string, imageKey: string): boolean {
  return (
    UUID_PATTERN.test(shopId) &&
    IMAGE_KEY_PATTERN.test(imageKey) &&
    imageKey.toLowerCase().startsWith(`${shopId.toLowerCase()}/`)
  );
}
