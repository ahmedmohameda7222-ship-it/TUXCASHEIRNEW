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

export const getProductSectionHref = (section: ProductRouteSection) => {
  const routeKey = section.slug || section.id;
  return PRODUCT_SECTION_ROUTES[section.id] || `/products/${routeKey}`;
};
