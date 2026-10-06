export function detailIdFromPath(pathname: string, basePath: string): string | null {
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const prefix = `${normalizedBase}/`;
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length).split('/')[0];
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

export function detailPath(basePath: string, entityId: string): string {
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${normalizedBase}/${encodeURIComponent(entityId)}`;
}
