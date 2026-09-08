interface DesktopOnlineOrderSessionManager {
  authorizationHeaders(): Promise<Readonly<Record<string, string>>>;
}

function supabaseProjectOrigin(rawProjectUrl: string): string {
  const url = new URL(rawProjectUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase project URL must use HTTPS.');
  return url.origin;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Online-order Operations remote returned invalid JSON.');
  }
  if (!response.ok) {
    throw new Error(`Online-order Operations remote failed with HTTP ${response.status}.`);
  }
  return payload;
}

export class SupabaseDesktopOnlineOrderOperationsRemote {
  readonly #endpoint: string;
  readonly #sessionManager: DesktopOnlineOrderSessionManager;
  readonly #fetcher: typeof fetch;

  constructor(input: {
    readonly projectUrl: string;
    readonly sessionManager: DesktopOnlineOrderSessionManager;
    readonly fetcher?: typeof fetch;
  }) {
    this.#endpoint = `${supabaseProjectOrigin(input.projectUrl)}/functions/v1/online-order-operations`;
    this.#sessionManager = input.sessionManager;
    this.#fetcher = input.fetcher ?? fetch;
  }

  async #request(
    method: 'GET' | 'POST',
    target: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const authHeaders = await this.#sessionManager.authorizationHeaders();
    const response = await this.#fetcher(target, {
      method,
      headers:
        body === undefined
          ? { ...authHeaders, accept: 'application/json' }
          : {
              ...authHeaders,
              accept: 'application/json',
              'content-type': 'application/json',
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    return parseJsonResponse(response);
  }

  async fetchActiveRequests(limit: number): Promise<unknown> {
    return this.#request('GET', `${this.#endpoint}?limit=${encodeURIComponent(String(limit))}`);
  }

  async claim(requestId: string): Promise<unknown> {
    return this.#request('POST', this.#endpoint, {
      action: 'CLAIM',
      requestId,
    });
  }

  async release(requestId: string, processingOrderId: string): Promise<unknown> {
    return this.#request('POST', this.#endpoint, {
      action: 'RELEASE',
      requestId,
      processingOrderId,
    });
  }

  async reject(requestId: string, reason: string): Promise<unknown> {
    return this.#request('POST', this.#endpoint, {
      action: 'REJECT',
      requestId,
      reason,
    });
  }
}
