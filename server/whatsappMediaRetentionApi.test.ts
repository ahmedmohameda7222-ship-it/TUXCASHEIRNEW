import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as retentionModule from './whatsappMediaRetention';

type RetentionCounts = {
  readonly scanned: number;
  readonly deleted: number;
  readonly failed: number;
};

type RetentionHttpResult = {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
};

type RetentionHttpHandler = (input: {
  readonly method: string | undefined;
  readonly authorization: string | undefined;
  readonly cronSecret: string | undefined;
  readonly now: string;
  readonly runRetention: () => Promise<RetentionCounts>;
}) => Promise<RetentionHttpResult>;

function retentionHttpHandler(): RetentionHttpHandler {
  const candidate = (retentionModule as Readonly<Record<string, unknown>>)[
    'handleWhatsAppMediaRetentionRequest'
  ];
  expect(typeof candidate).toBe('function');
  if (typeof candidate !== 'function') {
    return async () => ({ statusCode: 500, body: null });
  }
  return candidate as RetentionHttpHandler;
}

describe('WhatsApp media retention HTTP authority', () => {
  it('has a repository endpoint and exact Vercel cron schedule', () => {
    expect(existsSync(resolve('api/whatsapp-media-retention.ts'))).toBe(true);
    const vercel = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8')) as {
      readonly crons?: unknown;
    };
    expect(vercel.crons).toEqual([
      {
        path: '/api/whatsapp-media-retention',
        schedule: '17 3 * * *',
      },
    ]);
  });

  it.each([undefined, '', '   '])(
    'fails closed with 503 when CRON_SECRET is missing or blank (%p)',
    async (cronSecret) => {
      const runRetention = vi.fn(async () => ({ scanned: 1, deleted: 1, failed: 0 }));
      const result = await retentionHttpHandler()({
        method: 'GET',
        authorization: 'Bearer anything',
        cronSecret,
        now: '2026-10-05T03:17:00.000Z',
        runRetention,
      });
      expect(result.statusCode).toBe(503);
      expect(runRetention).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'Bearer wrong-secret', 'Basic cron-secret'])(
    'returns 401 for missing or wrong cron authorization (%p)',
    async (authorization) => {
      const runRetention = vi.fn(async () => ({ scanned: 1, deleted: 1, failed: 0 }));
      const result = await retentionHttpHandler()({
        method: 'GET',
        authorization,
        cronSecret: 'cron-secret',
        now: '2026-10-05T03:17:00.000Z',
        runRetention,
      });
      expect(result.statusCode).toBe(401);
      expect(runRetention).not.toHaveBeenCalled();
    },
  );

  it('does not accept worker or device authority as a substitute for CRON_SECRET', async () => {
    const runRetention = vi.fn(async () => ({ scanned: 1, deleted: 1, failed: 0 }));
    const result = await retentionHttpHandler()({
      method: 'GET',
      authorization: 'Bearer worker-device-token',
      cronSecret: 'cron-secret',
      now: '2026-10-05T03:17:00.000Z',
      runRetention,
    });
    expect(result.statusCode).toBe(401);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it('executes one bounded retention pass only for the exact Bearer CRON_SECRET', async () => {
    const counts = { scanned: 3, deleted: 2, failed: 1 } as const;
    const runRetention = vi.fn(async () => counts);
    const result = await retentionHttpHandler()({
      method: 'GET',
      authorization: 'Bearer cron-secret',
      cronSecret: 'cron-secret',
      now: '2026-10-05T03:17:00.000Z',
      runRetention,
    });
    expect(result).toMatchObject({ statusCode: 200, body: counts });
    expect(runRetention).toHaveBeenCalledTimes(1);
  });

  it('rejects non-GET methods without running retention', async () => {
    const runRetention = vi.fn(async () => ({ scanned: 1, deleted: 1, failed: 0 }));
    const result = await retentionHttpHandler()({
      method: 'POST',
      authorization: 'Bearer cron-secret',
      cronSecret: 'cron-secret',
      now: '2026-10-05T03:17:00.000Z',
      runRetention,
    });
    expect(result.statusCode).toBe(405);
    expect(result.headers).toMatchObject({ Allow: 'GET' });
    expect(runRetention).not.toHaveBeenCalled();
  });
});
