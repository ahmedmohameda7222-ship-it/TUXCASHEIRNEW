import { instant } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { syncStatusStore } from './syncStatus';
import { SyncStatusIndicator } from './SyncStatusIndicator';

describe('SyncStatusIndicator diagnostics', () => {
  it('shows Retrying with pending count and exposes safe delivery diagnostics', () => {
    syncStatusStore.setExternalSnapshot({
      state: 'SYNC_RETRYING',
      label: 'Sync retrying',
      remoteConfigured: true,
      attentionRequired: false,
      pendingCount: 2,
      lastSuccessfulDeliveryAt: instant('2026-10-24T03:00:00.000Z'),
      lastError: 'Remote outbox endpoint rejected event with HTTP 401.',
      nextRetryAt: instant('2026-10-24T03:05:00.000Z'),
    });

    const html = renderToStaticMarkup(<SyncStatusIndicator />);

    expect(html).toContain('Sync retrying · 2 pending');
    expect(html).toContain('Last successful delivery: 2026-10-24T03:00:00.000Z');
    expect(html).toContain('Last error: Remote outbox endpoint rejected event with HTTP 401.');
    expect(html).toContain('Next retry: 2026-10-24T03:05:00.000Z');
  });
});
