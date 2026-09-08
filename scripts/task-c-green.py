from pathlib import Path


def replace_once(path_str: str, old: str, new: str) -> None:
    path = Path(path_str)
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"anchor missing in {path_str}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path_str}: {text.count(old)} matches")
    path.write_text(text.replace(old, new, 1))


replace_once(
    "packages/catalog-contracts/src/index.ts",
    """export interface PublicCatalogModifierV1 {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly active: boolean;
  readonly sortOrder: number;
}""",
    """export interface PublicCatalogModifierV1 {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly standaloneProductId: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}""",
)
replace_once(
    "packages/catalog-contracts/src/index.ts",
    "function requiredSlug(value: unknown, path: string): string {",
    """function nullableUuid(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requiredUuid(value, path);
}

function requiredSlug(value: unknown, path: string): string {""",
)
replace_once(
    "packages/catalog-contracts/src/index.ts",
    """  exactKeys(row, ['id', 'name', 'priceMinor', 'active', 'sortOrder'], path);
  return {
    id: requiredUuid(row.id, `${path}.id`),
    name: requiredText(row.name, `${path}.name`, 200),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    active: requiredBoolean(row.active, `${path}.active`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };""",
    """  exactKeys(
    row,
    ['id', 'name', 'priceMinor', 'standaloneProductId', 'active', 'sortOrder'],
    path,
  );
  return {
    id: requiredUuid(row.id, `${path}.id`),
    name: requiredText(row.name, `${path}.name`, 200),
    priceMinor: nonNegativeInteger(row.priceMinor, `${path}.priceMinor`),
    standaloneProductId: nullableUuid(row.standaloneProductId, `${path}.standaloneProductId`),
    active: requiredBoolean(row.active, `${path}.active`),
    sortOrder: nonNegativeInteger(row.sortOrder, `${path}.sortOrder`),
  };""",
)
replace_once(
    "packages/catalog-contracts/src/index.test.ts",
    "      { id: MODIFIER_ID, name: 'Extra cheese', priceMinor: 2000, active: true, sortOrder: 1 },",
    """      {
        id: MODIFIER_ID,
        name: 'Extra cheese',
        priceMinor: 2000,
        standaloneProductId: null,
        active: true,
        sortOrder: 1,
      },""",
)

replace_once(
    "supabase/functions/catalog-public/catalog.ts",
    """export interface PublicModifierRow extends Row {
  readonly id: string;
  readonly shop_id: string;
  readonly name: string;
  readonly price_minor: number;
  readonly active: boolean;
  readonly sort_order: number;
}""",
    """export interface PublicModifierRow extends Row {
  readonly id: string;
  readonly shop_id: string;
  readonly name: string;
  readonly price_minor: number;
  readonly standalone_product_id: string | null;
  readonly active: boolean;
  readonly sort_order: number;
}""",
)
replace_once(
    "supabase/functions/catalog-public/catalog.ts",
    """  const modifiers = modifierRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      priceMinor: requireMoney(row.price_minor, `modifier ${row.id}`),
      active: row.active,
      sortOrder: row.sort_order,
    }))
    .sort(sortByOrderThenId);""",
    """  const modifiers = modifierRows
    .map((row) => {
      if (row.standalone_product_id !== null && !productIds.has(row.standalone_product_id)) {
        throw new CatalogUnavailableError(`modifier ${row.id} has unknown standalone product`);
      }
      return {
        id: row.id,
        name: row.name,
        priceMinor: requireMoney(row.price_minor, `modifier ${row.id}`),
        standaloneProductId: row.standalone_product_id,
        active: row.active,
        sortOrder: row.sort_order,
      };
    })
    .sort(sortByOrderThenId);""",
)

replace_once(
    "supabase/functions/catalog-public/catalog-public.deno.ts",
    "{ id: MODIFIER_ID, shop_id: SHOP_ID, name: 'Extra cheese', price_minor: 2000, active: true, sort_order: 1, standalone_product_id: null },",
    "{ id: MODIFIER_ID, shop_id: SHOP_ID, name: 'Extra cheese', price_minor: 2000, active: true, sort_order: 1, standalone_product_id: PRODUCT_B },",
)
replace_once(
    "supabase/functions/catalog-public/catalog-public.deno.ts",
    """  const products = payload.products as Array<Record<string, unknown>>;
  assert(categories[0]?.id === CATEGORY_A && categories[1]?.id === CATEGORY_B, 'category ordering unstable');""",
    """  const products = payload.products as Array<Record<string, unknown>>;
  const modifiers = payload.modifiers as Array<Record<string, unknown>>;
  assert(categories[0]?.id === CATEGORY_A && categories[1]?.id === CATEGORY_B, 'category ordering unstable');""",
)
replace_once(
    "supabase/functions/catalog-public/catalog-public.deno.ts",
    """  assert(products[1]?.active === false && products[1]?.soldOut === true, 'availability semantics lost');
  assert(!('shop_id' in products[0]!) && !('cost_minor' in products[0]!), 'internal fields leaked');""",
    """  assert(products[1]?.active === false && products[1]?.soldOut === true, 'availability semantics lost');
  assert(modifiers[0]?.standaloneProductId === PRODUCT_B, 'standalone modifier identity lost');
  assert(!('shop_id' in products[0]!) && !('cost_minor' in products[0]!), 'internal fields leaked');""",
)

replace_once(
    "apps/menu/src/context/menuProjection.ts",
    """export interface MenuModifier {
  id: string;
  name: string;
  price_minor: number;
  price: number;
  is_active: boolean;
  max_quantity: number | null;
  sort_order: number;
}""",
    """export interface MenuModifier {
  id: string;
  name: string;
  price_minor: number;
  price: number;
  is_active: boolean;
  max_quantity: number | null;
  sort_order: number;
}

export interface MenuExtraOption {
  id: string;
  name: string;
  price: number;
}""",
)
replace_once(
    "apps/menu/src/context/menuProjection.ts",
    """  readonly modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  readonly comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;""",
    """  readonly modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  readonly extrasByProduct: Readonly<Record<string, readonly MenuExtraOption[]>>;
  readonly comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;""",
)
replace_once(
    "apps/menu/src/context/menuProjection.ts",
    """  for (const modifiers of Object.values(modifiersByProduct)) {
    modifiers.sort((left, right) => left.sort_order - right.sort_order);
  }

  const productsById = new Map(products.map((product) => [product.id, product] as const));""",
    """  for (const modifiers of Object.values(modifiersByProduct)) {
    modifiers.sort((left, right) => left.sort_order - right.sort_order);
  }

  const productsById = new Map(products.map((product) => [product.id, product] as const));
  const extrasByProduct: Record<string, MenuExtraOption[]> = {};
  const sortedLinks = [...snapshot.productModifierLinks].sort(
    (left, right) =>
      left.productId.localeCompare(right.productId) ||
      left.sortOrder - right.sortOrder ||
      left.modifierId.localeCompare(right.modifierId),
  );
  for (const link of sortedLinks) {
    const modifier = modifiersById.get(link.modifierId);
    if (!modifier?.active || modifier.standaloneProductId === null) continue;
    const standaloneProduct = productsById.get(modifier.standaloneProductId);
    if (!standaloneProduct?.is_active) continue;
    (extrasByProduct[link.productId] ??= []).push({
      id: standaloneProduct.id,
      name: modifier.name,
      price: modifier.priceMinor / 100,
    });
  }""",
)
replace_once(
    "apps/menu/src/context/menuProjection.ts",
    """    modifiersByProduct,
    comboBeveragesByProduct,""",
    """    modifiersByProduct,
    extrasByProduct,
    comboBeveragesByProduct,""",
)

replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """  type MenuModifier,
  type SupabaseProduct,""",
    """  type MenuExtraOption,
  type MenuModifier,
  type SupabaseProduct,""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """  MenuModifier,
  ProductSection,""",
    """  MenuExtraOption,
  MenuModifier,
  ProductSection,""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """  modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;""",
    """  modifiersByProduct: Readonly<Record<string, readonly MenuModifier[]>>;
  extrasByProduct: Readonly<Record<string, readonly MenuExtraOption[]>>;
  comboBeveragesByProduct: Readonly<Record<string, readonly SupabaseProduct[]>>;""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    "  const [comboBeveragesByProduct, setComboBeveragesByProduct] = useState<",
    """  const [extrasByProduct, setExtrasByProduct] = useState<
    Readonly<Record<string, readonly MenuExtraOption[]>>
  >({});
  const [comboBeveragesByProduct, setComboBeveragesByProduct] = useState<""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """      setModifiersByProduct(projection.modifiersByProduct);
      setComboBeveragesByProduct(projection.comboBeveragesByProduct);""",
    """      setModifiersByProduct(projection.modifiersByProduct);
      setExtrasByProduct(projection.extrasByProduct);
      setComboBeveragesByProduct(projection.comboBeveragesByProduct);""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """      setModifiersByProduct({});
      setComboBeveragesByProduct({});""",
    """      setModifiersByProduct({});
      setExtrasByProduct({});
      setComboBeveragesByProduct({});""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    """      modifiersByProduct,
      comboBeveragesByProduct,""",
    """      modifiersByProduct,
      extrasByProduct,
      comboBeveragesByProduct,""",
)
replace_once(
    "apps/menu/src/context/MenuContext.tsx",
    "    [sections, products, modifiersByProduct, comboBeveragesByProduct, loading, error, refreshMenu],",
    """    [
      sections,
      products,
      modifiersByProduct,
      extrasByProduct,
      comboBeveragesByProduct,
      loading,
      error,
      refreshMenu,
    ],""",
)

replace_once(
    "apps/menu/src/components/order/ProductOrderCard.tsx",
    "import { type SupabaseProduct } from '@/context/MenuContext';",
    "import { type MenuExtraOption, type SupabaseProduct } from '@/context/MenuContext';",
)
replace_once(
    "apps/menu/src/components/order/ProductOrderCard.tsx",
    "  extras?: SupabaseProduct[];",
    "  extras?: readonly MenuExtraOption[];",
)
replace_once(
    "apps/menu/src/components/order/ProductOrderCard.tsx",
    "  const canAddExtras = !unavailable && product.section_id !== 'extras' && extras.length > 0;",
    "  const canAddExtras = !unavailable && extras.length > 0;",
)

replace_once(
    "apps/menu/src/pages/OrderNow.tsx",
    "  const { sections, products, loading } = useMenu();",
    "  const { sections, products, extrasByProduct, loading } = useMenu();",
)
order_now = Path("apps/menu/src/pages/OrderNow.tsx")
text = order_now.read_text()
old_block = """  const extraProducts = useMemo(
    () =>
      extrasSectionId === null
        ? []
        : products.filter(
            (product) => product.section_id === extrasSectionId && product.is_active,
          ),
    [extrasSectionId, products],
  );
"""
if old_block not in text:
    raise SystemExit("OrderNow extraProducts block anchor missing")
order_now.write_text(text.replace(old_block, "", 1))
replace_once(
    "apps/menu/src/pages/OrderNow.tsx",
    "extras={extraProducts}",
    "extras={extrasByProduct[product.id] ?? []}",
)
Path("apps/menu/src/pages/OrderNow.source.test.ts").write_text(
    """import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OrderNow.tsx', import.meta.url), 'utf8');

describe('OrderNow canonical category and extra identity', () => {
  it('keeps Extras category presentation-only and authorizes extras per product', () => {
    expect(source).toContain(\"section.slug === 'extras'\");
    expect(source).not.toContain(\"const EXTRAS_SECTION_ID = 'extras'\");
    expect(source).toContain('extrasByProduct[product.id]');
    expect(source).not.toContain('extras={extraProducts}');
  });
});
"""
)

old_migration = Path("supabase/migrations/20260907194500_catalog_public_identity.sql").read_text()
function_and_grants = old_migration[old_migration.index("create or replace function public.read_catalog_public_v1") :]
function_and_grants = function_and_grants.split("\n-- Catalog images are customer-facing.", 1)[0].rstrip() + "\n"
modifier_anchor = "            'price_minor', m.price_minor,\n            'active', m.active,"
if modifier_anchor not in function_and_grants:
    raise SystemExit("catalog public RPC modifier anchor missing")
function_and_grants = function_and_grants.replace(
    modifier_anchor,
    "            'price_minor', m.price_minor,\n            'standalone_product_id', m.standalone_product_id,\n            'active', m.active,",
    1,
)
Path("supabase/migrations/20260908051000_catalog_public_modifier_identity.sql").write_text(
    """-- Expose canonical standalone modifier product identity to the public catalog projection.
-- Repository migration only. Do not apply remotely without explicit production authorization.

"""
    + function_and_grants
)
