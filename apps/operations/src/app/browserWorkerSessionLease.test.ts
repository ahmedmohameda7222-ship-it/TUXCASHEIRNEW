import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserRemoteGateway, WorkerSessionLeaseLostError } from './browserRemote';
import { parseEntityId, type BusinessDayId, type WorkerSessionId } from '@tux/domain';

const dayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const sessionId = parseEntityId<WorkerSessionId>('30000000-0000-4000-8000-000000000001');

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { hostname: 'operations.example', origin: 'https://operations.example' },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('browser worker-session heartbeat', () => {
  it('classifies an explicitly ended canonical session as a local fencing signal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(
      new VercelBrowserRemoteGateway().touchWorkerSession(dayId, sessionId),
    ).rejects.toBeInstanceOf(WorkerSessionLeaseLostError);
  });

  it('keeps a transient server outage retryable instead of treating it as lease loss', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(
      new VercelBrowserRemoteGateway().touchWorkerSession(dayId, sessionId),
    ).rejects.toThrow('HTTP 503');
  });
});
