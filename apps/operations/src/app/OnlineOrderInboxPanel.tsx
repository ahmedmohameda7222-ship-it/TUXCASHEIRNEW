import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { IndexedDbOnlineOrderInboxStore } from '@tux/persistence/browser';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { createOperationsSessionClient } from './sessionClient';
import {
  createOnlineOrderInboxRuntime,
  type OnlineOrderInboxRuntimeClient,
  type OnlineOrderInboxSnapshot,
} from './onlineOrderInboxClient';
import { BrowserOnlineOrderOperationsRemote } from './onlineOrderInboxSync';
import './OnlineOrderInboxPanel.css';

const EMPTY_SNAPSHOT: OnlineOrderInboxSnapshot = {
  requests: [],
  syncState: 'CACHED',
  errorMessage: null,
};

let browserClientPromise: Promise<OnlineOrderInboxRuntimeClient> | null = null;

function money(minor: number): string {
  const value = Math.abs(minor);
  const sign = minor < 0 ? '-' : '';
  return `${sign}E£${Math.floor(value / 100).toLocaleString()}${
    value % 100 === 0 ? '' : `.${String(value % 100).padStart(2, '0')}`
  }`;
}

function fulfillmentLabel(request: CachedOnlineOrderRequest): string {
  return request.fulfillmentPreference === 'DELIVERY' ? 'Delivery' : 'Pickup';
}

function paymentLabel(request: CachedOnlineOrderRequest): string {
  switch (request.paymentPreference) {
    case 'CASH':
      return 'Cash requested';
    case 'INSTAPAY':
      return 'Instapay requested';
    case 'MIXED':
      return 'Mixed payment requested';
  }
}

function missingFacts(request: CachedOnlineOrderRequest): readonly string[] {
  return [
    ...(request.fulfillmentPreference === 'DELIVERY' ? ['delivery zone and fee'] : []),
    'payment method and amount',
    'current operator and business day',
  ];
}

async function browserOnlineOrderInboxClient(): Promise<OnlineOrderInboxRuntimeClient> {
  if (browserClientPromise === null) {
    browserClientPromise = (async () => {
      const store = new IndexedDbOnlineOrderInboxStore();
      await store.initialize();
      const sessionClient = createOperationsSessionClient();
      return createOnlineOrderInboxRuntime({
        getActiveShopId: async () => {
          const state = await sessionClient.getState();
          if (!state.ok || state.value.status !== 'ACTIVE') {
            throw new Error('Active worker session required for online-order review.');
          }
          return state.value.shopId;
        },
        store,
        remote: new BrowserOnlineOrderOperationsRemote(),
      });
    })();
  }
  return browserClientPromise;
}

export function createOperationsOnlineOrderInboxClient(): OnlineOrderInboxRuntimeClient {
  const desktop = window.tuxDesktop?.onlineOrders;
  if (desktop !== undefined) return desktop;

  return {
    load: async () => (await browserOnlineOrderInboxClient()).load(),
    claim: async (requestId) => (await browserOnlineOrderInboxClient()).claim(requestId),
    release: async (requestId, processingOrderId) =>
      (await browserOnlineOrderInboxClient()).release(requestId, processingOrderId),
    reject: async (requestId, processingOrderId, reason) =>
      (await browserOnlineOrderInboxClient()).reject(requestId, processingOrderId, reason),
    subscribe: (listener) => {
      let active = true;
      let unsubscribe = (): void => undefined;
      void browserOnlineOrderInboxClient().then((client) => {
        if (!active) return;
        unsubscribe = client.subscribe(listener);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}

export function OnlineOrderInboxPanel({
  snapshot,
  busyRequestId,
  onClaim,
  onRelease,
  onReject,
}: {
  readonly snapshot: OnlineOrderInboxSnapshot;
  readonly busyRequestId: string | null;
  readonly onClaim: (requestId: string) => void | Promise<void>;
  readonly onRelease: (requestId: string, processingOrderId: string) => void | Promise<void>;
  readonly onReject: (
    requestId: string,
    processingOrderId: string,
    reason: string,
  ) => void | Promise<void>;
}) {
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const processing = useMemo(
    () => snapshot.requests.filter((request) => request.status === 'PROCESSING').length,
    [snapshot.requests],
  );

  function closeReject(): void {
    setRejectingRequestId(null);
    setRejectReason('');
  }

  function submitReject(
    event: FormEvent<HTMLFormElement>,
    request: CachedOnlineOrderRequest,
  ): void {
    event.preventDefault();
    if (request.processingOrderId === null || rejectReason.trim().length === 0) return;
    void Promise.resolve(
      onReject(request.requestId, request.processingOrderId, rejectReason.trim()),
    ).then(closeReject, () => undefined);
  }

  return (
    <section className="online-order-inbox" aria-labelledby="online-order-inbox-title">
      <header className="online-order-inbox-heading">
        <div>
          <p className="eyebrow">ONLINE</p>
          <h2 id="online-order-inbox-title">Incoming web orders</h2>
          <p>
            {snapshot.requests.length} waiting · {processing} in review
          </p>
        </div>
        <span className="online-order-sync-state">{snapshot.syncState.replace('_', ' ')}</span>
      </header>

      {snapshot.syncState === 'REMOTE_UNAVAILABLE' && snapshot.errorMessage !== null ? (
        <div className="online-order-warning" role="status">
          {snapshot.errorMessage}
        </div>
      ) : null}

      {snapshot.requests.length === 0 ? (
        <p className="online-order-empty">No incoming web orders.</p>
      ) : (
        <div className="online-order-grid">
          {snapshot.requests.map((request) => {
            const isBusy = busyRequestId === request.requestId;
            const isProcessing = request.status === 'PROCESSING';
            const facts = missingFacts(request);
            return (
              <article className="online-order-card" key={request.requestId}>
                <header>
                  <div>
                    <span className="online-order-status">
                      {isProcessing ? 'In review' : 'Pending review'}
                    </span>
                    <strong>{request.customerName}</strong>
                  </div>
                  <time>
                    {new Date(request.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </header>

                <dl className="online-order-facts">
                  <div>
                    <dt>Fulfillment</dt>
                    <dd>{fulfillmentLabel(request)}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{paymentLabel(request)}</dd>
                  </div>
                  <div>
                    <dt>Requested subtotal</dt>
                    <dd>{money(request.itemsSubtotalMinor)}</dd>
                  </div>
                </dl>

                {request.normalizedPhone === null ? null : <p>{request.normalizedPhone}</p>}
                {request.deliveryAddress === null ? null : <p>{request.deliveryAddress}</p>}
                <p className="online-order-item-count">
                  {request.trustedItems.reduce((sum, item) => sum + item.quantity, 0)} item(s) ·
                  canonical item snapshot received
                </p>
                {request.orderNote === null ? null : (
                  <p className="board-note">Customer note: {request.orderNote}</p>
                )}

                {isProcessing ? (
                  <div className="online-order-authority-note">
                    <strong>Confirm before accepting</strong>
                    <p>{facts.join('; ')}.</p>
                  </div>
                ) : null}

                {rejectingRequestId === request.requestId && request.processingOrderId !== null ? (
                  <form
                    className="online-order-reject-form"
                    onSubmit={(event) => submitReject(event, request)}
                  >
                    <label>
                      Rejection reason
                      <input
                        value={rejectReason}
                        maxLength={500}
                        onChange={(event) => setRejectReason(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <div>
                      <button
                        className="board-danger-button"
                        type="submit"
                        disabled={isBusy || rejectReason.trim().length === 0}
                      >
                        Confirm Reject
                      </button>
                      <button className="board-quiet-button" type="button" onClick={closeReject}>
                        Keep reviewing
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="online-order-actions">
                    {isProcessing && request.processingOrderId !== null ? (
                      <>
                        <button
                          className="board-secondary-button"
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void onRelease(request.requestId, request.processingOrderId!)
                          }
                        >
                          Release
                        </button>
                        <button
                          className="board-danger-button"
                          type="button"
                          disabled={isBusy}
                          onClick={() => setRejectingRequestId(request.requestId)}
                        >
                          Reject
                        </button>
                        <button
                          className="board-primary-button"
                          type="button"
                          disabled
                          title="Required POS delivery, payment, operator, and business-day facts must be confirmed first."
                        >
                          Accept in POS
                        </button>
                      </>
                    ) : (
                      <button
                        className="board-primary-button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void onClaim(request.requestId)}
                      >
                        Review
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function OnlineOrderInboxPanelController({
  client: providedClient,
}: {
  readonly client?: OnlineOrderInboxRuntimeClient;
}) {
  const client = useMemo(
    () => providedClient ?? createOperationsOnlineOrderInboxClient(),
    [providedClient],
  );
  const [snapshot, setSnapshot] = useState<OnlineOrderInboxSnapshot>(EMPTY_SNAPSHOT);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = client.subscribe((next) => {
      if (active) setSnapshot(next);
    });
    void client
      .load()
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error: unknown) => {
        if (active) {
          setActionError(
            error instanceof Error ? error.message : 'Could not load incoming web orders.',
          );
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  async function run(requestId: string, action: () => Promise<unknown>): Promise<void> {
    setBusyRequestId(requestId);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Online-order review action failed.');
    } finally {
      setBusyRequestId(null);
    }
  }

  return (
    <>
      {actionError === null ? null : (
        <div className="board-inline-error" role="alert">
          {actionError}
        </div>
      )}
      <OnlineOrderInboxPanel
        snapshot={snapshot}
        busyRequestId={busyRequestId}
        onClaim={(requestId) => run(requestId, () => client.claim(requestId))}
        onRelease={(requestId, processingOrderId) =>
          run(requestId, () => client.release(requestId, processingOrderId))
        }
        onReject={(requestId, processingOrderId, reason) =>
          run(requestId, () => client.reject(requestId, processingOrderId, reason))
        }
      />
    </>
  );
}
