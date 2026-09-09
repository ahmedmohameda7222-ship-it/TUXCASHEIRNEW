export type ProductRouteSection = {
  id: string;
  slug?: string;
};

export interface CanonicalCategoryRouteTarget {
  readonly categorySlug: string;
  readonly family: string | null;
}

export const PRODUCT_SECTION_ROUTES: Record<string, string> = {
  'tux-burger': '/tux-burger',
  tuxify: '/tuxify',
  hawawshi: '/hawawshi',
  fries: '/fries',
  combos: '/combos',
  drinks: '/drinks',
};

const FAMILY_CATEGORY_ROUTES: Readonly<Record<string, CanonicalCategoryRouteTarget>> = {
  'tux-burger': { categorySlug: 'burgers', family: 'TUX' },
  tuxify: { categorySlug: 'burgers', family: 'TUXIFY' },
};

const ORDER_PRODUCT_ELEMENT_PREFIX = 'order-product-';

export const resolveCanonicalCategoryRoute = (routeSlug: string): CanonicalCategoryRouteTarget =>
  FAMILY_CATEGORY_ROUTES[routeSlug] ?? { categorySlug: routeSlug, family: null };

export const getProductSectionHref = (section: ProductRouteSection) => {
  const routeKey = section.slug || section.id;
  return PRODUCT_SECTION_ROUTES[routeKey] || `/products/${routeKey}`;
};

export const getOrderProductElementId = (productId: string) =>
  `${ORDER_PRODUCT_ELEMENT_PREFIX}${encodeURIComponent(productId)}`;

export const getOrderProductHref = (productId: string) =>
  `/order-now#${getOrderProductElementId(productId)}`;

export const isOrderProductElementId = (elementId: string) =>
  elementId.startsWith(ORDER_PRODUCT_ELEMENT_PREFIX);
