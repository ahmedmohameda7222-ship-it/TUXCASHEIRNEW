import type { AdminServerEnv } from './env';

export class AdminSupabaseError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`admin_supabase_request_failed:${status}`);
    this.name = 'AdminSupabaseError';
  }
}

export class AdminSupabaseClient {
  constructor(
    private readonly env: Pick<AdminServerEnv, 'supabaseUrl' | 'serviceRoleKey'>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.env.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.env.serviceRoleKey,
        authorization: `Bearer ${this.env.serviceRoleKey}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    if (!response.ok) throw new AdminSupabaseError(response.status, text.slice(0, 2048));
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  select<T>(table: string, query: URLSearchParams): Promise<T> {
    return this.request<T>(`${table}?${query.toString()}`, { method: 'GET' });
  }

  rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T> {
    return this.request<T>(`rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  insert<T>(table: string, payload: unknown): Promise<T> {
    return this.request<T>(table, {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
  }

  update<T>(table: string, query: URLSearchParams, payload: unknown): Promise<T> {
    return this.request<T>(`${table}?${query.toString()}`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
  }
}
