import { describe, expect, it, vi } from 'vitest';

import {
  createSupabaseCatalogSchedulerExecutors,
  createSupabaseCatalogSchedulerStore,
  handleCatalogSchedulerRequest,
  runCatalogScheduler,
  type CatalogScheduledChange,
  type CatalogSchedulerRpcClient,
  type CatalogSchedulerStore,
} from './scheduler';

function createStore(): CatalogSchedulerStore {
  let claimed = false;
  let applied = false;
  const dueChange: CatalogScheduledChange = {
    id: 'schedule-1',
    businessId: 'business-1',
    shopId: 'shop-a',
    createdByEmployeeId: 'employee-1',
    changeKind: 'CATALOG_PUBLISH',
    payload: { draftId: 'draft-1', expectedDraftRevision: 3 },
    scheduledFor: '2026-09-11T05:00:00.000Z',
    targetBasePublishVersion: 48,
    idempotencyKey: 'publish:draft-1:48',
    attemptCount: 0,
  };

  return {
    claimDue: vi.fn(async () => {
      if (claimed || applied) return [];
      claimed = true;
      return [dueChange];
    }),
    markApplied: vi.fn(async () => {
      applied = true;
    }),
    markFailed: vi.fn(async () => {
      claimed = false;
    }),
  };
}

describe('catalog scheduler', () => {
  it('activates a due Cairo schedule exactly once across repeated runs', async () => {
    const store = createStore();
    const publish = vi.fn().mockResolvedValue({ ok: true, publishVersion: 49 });

    const deps = {
      store,
      publish,
      setAvailability: vi.fn(),
      materializeRecurring: vi.fn().mockResolvedValue({ ok: true, materialized: 0 }),
      now: () => new Date('2026-09-11T05:00:00.000Z'),
    };

    await runCatalogScheduler(deps);
    await runCatalogScheduler(deps);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.markApplied).toHaveBeenCalledTimes(1);
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('materializes recurring availability boundaries before claiming due work', async () => {
    const events: string[] = [];
    const store: CatalogSchedulerStore = {
      claimDue: vi.fn(async () => {
        events.push('claim');
        return [];
      }),
      markApplied: vi.fn(),
      markFailed: vi.fn(),
    };
    const materializeRecurring = vi.fn(async (now: string) => {
      events.push(`materialize:${now}`);
      return { ok: true, materialized: 2 };
    });

    await runCatalogScheduler({
      store,
      publish: vi.fn(),
      setAvailability: vi.fn(),
      materializeRecurring,
      now: () => new Date('2026-09-11T18:00:00.000Z'),
    });

    expect(materializeRecurring).toHaveBeenCalledWith('2026-09-11T18:00:00.000Z');
    expect(events).toEqual(['materialize:2026-09-11T18:00:00.000Z', 'claim']);
  });

  it('routes recurring availability jobs through the dedicated baseline-preserving RPC', async () => {
    const rpc = vi.fn(async () => ({ ok: true, publishVersion: 50 }));
    const client: CatalogSchedulerRpcClient = {
      async rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T> {
        return (await rpc(name, payload)) as T;
      },
    };
    const executors = createSupabaseCatalogSchedulerExecutors(client);
    const recurringChange: CatalogScheduledChange = {
      id: 'schedule-recurring-1',
      businessId: 'business-1',
      shopId: 'shop-a',
      createdByEmployeeId: 'employee-1',
      changeKind: 'PRODUCT_AVAILABILITY',
      payload: {
        ruleId: 'rule-1',
        ruleVersion: 3,
        transition: 'EXIT',
      },
      scheduledFor: '2026-09-11T23:00:00.000Z',
      targetBasePublishVersion: null,
      idempotencyKey: 'recurring:rule-1:v3:2026-09-11:exit',
      attemptCount: 1,
    };

    await executors.setAvailability(recurringChange);

    expect(rpc).toHaveBeenCalledWith('apply_recurring_product_availability_v1', {
      p_employee_id: 'employee-1',
      p_shop_id: 'shop-a',
      p_rule_id: 'rule-1',
      p_rule_version: 3,
      p_transition: 'EXIT',
    });
  });

  it('maps durable scheduler claims and terminal transitions through trusted RPCs', async () => {
    const rpc = vi.fn(async (name: string, payload: Readonly<Record<string, unknown>>) => {
      void payload;
      if (name === 'claim_due_admin_config_changes_v1') {
        return [
          {
            id: 'schedule-1',
            business_id: 'business-1',
            shop_id: 'shop-a',
            created_by_employee_id: 'employee-1',
            change_kind: 'CATALOG_PUBLISH',
            payload_json: { draftId: 'draft-1', expectedDraftRevision: 3 },
            scheduled_for: '2026-09-11T05:00:00.000Z',
            target_base_publish_version: '48',
            idempotency_key: 'publish:draft-1:48',
            attempt_count: 1,
          },
        ];
      }
      return true;
    });
    const client: CatalogSchedulerRpcClient = {
      async rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T> {
        return (await rpc(name, payload)) as T;
      },
    };
    const store = createSupabaseCatalogSchedulerStore(client);

    const claimed = await store.claimDue({
      now: '2026-09-11T05:00:00.000Z',
      limit: 25,
    });
    expect(claimed).toEqual([
      {
        id: 'schedule-1',
        businessId: 'business-1',
        shopId: 'shop-a',
        createdByEmployeeId: 'employee-1',
        changeKind: 'CATALOG_PUBLISH',
        payload: { draftId: 'draft-1', expectedDraftRevision: 3 },
        scheduledFor: '2026-09-11T05:00:00.000Z',
        targetBasePublishVersion: 48,
        idempotencyKey: 'publish:draft-1:48',
        attemptCount: 1,
      },
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, 'claim_due_admin_config_changes_v1', {
      p_now: '2026-09-11T05:00:00.000Z',
      p_limit: 25,
      p_lease_seconds: 300,
    });

    await store.markApplied({
      id: 'schedule-1',
      idempotencyKey: 'publish:draft-1:48',
      result: { ok: true, publishVersion: 49 },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'mark_admin_config_change_applied_v1', {
      p_id: 'schedule-1',
      p_idempotency_key: 'publish:draft-1:48',
      p_result: { ok: true, publishVersion: 49 },
    });
  });

  it('fails closed when the cron secret is missing or invalid', async () => {
    const runScheduler = vi.fn().mockResolvedValue({ claimed: 0, applied: 0, failed: 0 });

    await expect(
      handleCatalogSchedulerRequest({
        method: 'GET',
        authorization: 'Bearer configured',
        cronSecret: undefined,
        runScheduler,
      }),
    ).resolves.toEqual({ statusCode: 503, body: { error: 'cron_secret_not_configured' } });

    await expect(
      handleCatalogSchedulerRequest({
        method: 'GET',
        authorization: 'Bearer wrong',
        cronSecret: 'configured',
        runScheduler,
      }),
    ).resolves.toEqual({ statusCode: 401, body: { error: 'unauthorized' } });

    expect(runScheduler).not.toHaveBeenCalled();
  });
});
