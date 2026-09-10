export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
  ) {
    super(errorCode);
    this.name = 'AdminApiError';
  }
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<T> {
  if (!path.startsWith('/api/admin/')) throw new Error('admin_api_path_required');
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (MUTATION_METHODS.has(method) && csrfToken) {
    headers.set('x-tux-admin-csrf', csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
  });

  let payload: unknown = undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) payload = await response.json();
  if (!response.ok) {
    const errorCode =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `admin_request_${response.status}`;
    throw new AdminApiError(response.status, errorCode);
  }
  return payload as T;
}
