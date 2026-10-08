export const ADMIN_VIEWPORTS = {
  smallPhone: { name: 'small phone', width: 320, height: 700 },
  phone: { name: 'phone', width: 390, height: 844 },
  tablet: { name: 'tablet', width: 768, height: 1024 },
  wideTablet: { name: 'wide tablet', width: 900, height: 1100 },
  laptop: { name: 'laptop', width: 1440, height: 960 },
} as const;

export const ADMIN_CORE_VIEWPORTS = [
  ADMIN_VIEWPORTS.phone,
  ADMIN_VIEWPORTS.tablet,
  ADMIN_VIEWPORTS.laptop,
] as const;

export const ADMIN_WIDE_TABLET_VIEWPORTS = [
  ADMIN_VIEWPORTS.phone,
  ADMIN_VIEWPORTS.wideTablet,
  ADMIN_VIEWPORTS.laptop,
] as const;
