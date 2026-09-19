import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  handleApprovalExecutionRequest,
  runApprovalExecutionRunner,
} from './approvalExecutionRunner';

describe('approval execution production runner', () => {
  it('fails closed when CRON_SECRET is missing or the bearer token is invalid', async () => {
    const run = vi.fn(async () => ({
      claimed: 0,
      executed: 0,
      retryable: 0,
      failed: 0,
    }));

    await expect(
      handleApprovalExecutionRequest({
        method: 'GET',
        authorization: 'Bearer configured',
        cronSecret: undefined,
        run,
      }),
    ).resolves.toEqual({
      statusCode: 503,
      body: { error: 'cron_secret_not_configured' },
    });

    await expect(
      handleApprovalExecutionRequest({
        method: 'POST',
        authorization: 'Bearer wrong',
        cronSecret: 'configured',
        run,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: 'unauthorized' } });

    expect(run).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods and never accepts caller command payload', async () => {
    const run = vi.fn(async () => ({
      claimed: 0,
      executed: 0,
      retryable: 0,
      failed: 0,
    }));

    await expect(
      handleApprovalExecutionRequest({
        method: 'PUT',
        authorization: 'Bearer configured',
        cronSecret: 'configured',
        run,
      }),
    ).resolves.toEqual({
      statusCode: 405,
      body: { error: 'method_not_allowed' },
      headers: { allow: 'GET, POST' },
    });

    expect(run).not.toHaveBeenCalled();
  });

  it('runs one bounded durable batch with server-owned dependencies', async () => {
    const execute = vi.fn(async () => ({
      claimed: 2,
      executed: 1,
      retryable: 1,
      failed: 0,
    }));

    await expect(runApprovalExecutionRunner({ execute })).resolves.toEqual({
      claimed: 2,
      executed: 1,
      retryable: 1,
      failed: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith();
  });

  it('does not register the approval executor as a Vercel Cron Job', async () => {
    const raw = await readFile(new URL('../../vercel.json', import.meta.url), 'utf8');
    const config = JSON.parse(raw) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    expect(config).not.toHaveProperty('crons');
  });
});
