import type { AdminRequest } from './http.js';

/** Return a bounded, non-sensitive operation label for structured server logs. */
export function adminRequestOperation(request: AdminRequest): string {
  if (request.method !== 'GET') return request.method === 'POST' ? 'command' : 'other';
  try {
    const url = new URL(request.url ?? '/', 'http://admin.local');
    const view = url.searchParams.get('view');
    if (view && /^[a-z][a-z-]{0,39}$/.test(view)) return view;
    if (url.pathname.endsWith('/inventory') && url.searchParams.has('inventoryItemId')) {
      return 'item-history';
    }
  } catch {
    // The invalid URL is handled by the resource handler; never log it.
  }
  return 'workspace';
}
