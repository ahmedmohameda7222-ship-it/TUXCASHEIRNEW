export function BrandLogo({ size = 36, decorative = true }: { size?: number; decorative?: boolean }) {
  return (
    <img
      className="admin-brand-logo"
      src="/favicon.svg"
      width={size}
      height={size}
      alt={decorative ? '' : 'TUX'}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
    />
  );
}
