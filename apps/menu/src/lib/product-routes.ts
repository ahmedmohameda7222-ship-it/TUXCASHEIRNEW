export type ProductRouteSection = {
  id: string;
  slug?: string;
};

export const PRODUCT_SECTION_ROUTES: Record<string, string> = {
  "tux-burger": "/tux-burger",
  tuxify: "/tuxify",
  hawawshi: "/hawawshi",
  fries: "/fries",
  combos: "/combos",
  drinks: "/drinks",
};

const ORDER_PRODUCT_ELEMENT_PREFIX = "order-product-";

export const getProductSectionHref = (section: ProductRouteSection) => {
  const routeKey = section.slug || section.id;
  return PRODUCT_SECTION_ROUTES[section.id] || `/products/${routeKey}`;
};

export const getOrderProductElementId = (productId: string) =>
  `${ORDER_PRODUCT_ELEMENT_PREFIX}${encodeURIComponent(productId)}`;

export const getOrderProductHref = (productId: string) =>
  `/order-now#${getOrderProductElementId(productId)}`;

export const isOrderProductElementId = (elementId: string) =>
  elementId.startsWith(ORDER_PRODUCT_ELEMENT_PREFIX);
