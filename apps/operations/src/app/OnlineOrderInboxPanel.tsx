import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { OnlineOrderAcceptanceConfirmation, OrdersWorkspace } from '@tux/application';
import { moneyMinor, type MoneyMinor } from '@tux/domain';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { IndexedDbOnlineOrderInboxStore } from '@tux/persistence/browser';
import type { TuxOnlineOrdersApi } from '@tux/platform-contracts';
import {
  createOperationsOnlineOrderAcceptanceClient,
  createOperationsOrdersClient,
  createOperationsSessionClient,
  type OperationsOrdersClient,
} from './sessionClient';
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

type OnlineOrderAcceptanceClient = Pick<TuxOnlineOrdersApi, 'accept'>;
export type OperationsOnlineOrderInboxClient = OnlineOrderInboxRuntimeClient &
  OnlineOrderAcceptanceClient;

let browserClientPromise: Promise<OnlineOrderInboxRuntimeClient> | null = null;
let browserAcceptanceClient: OnlineOrderAcceptanceClient | null = null;

function money(minor: number): string {
  const value = Math.abs(minor);
  const sign = minor < 0 ? '-' : '';
  return `${sign}E£${Math.floor(value / 100).toLocaleString()}${
    value % 100 === 0 ? '' : `.${String(value % 100).padStart(2, '0')}`
  }`;
}

function parseMinorInput(value: string): MoneyMinor | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? moneyMinor(minor) : null;
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

function acceptanceClient(): OnlineOrderAcceptanceClient {
  browserAcceptanceClient ??= createOperationsOnlineOrderAcceptanceClient();
  return browserAcceptanceClient;
}

export function createOperationsOnlineOrderInboxClient(): OperationsOnlineOrderInboxClient {
  const desktop = window.tuxDesktop?.onlineOrders;
  if (desktop !== undefined) return desktop;

  return {
    load: async () => (await browserOnlineOrderInboxClient()).load(),
    claim: async (requestId) => (await browserOnlineOrderInboxClient()).claim(requestId),
    release: async (requestId, processingOrderId) =>
      (await browserOnlineOrderInboxClient()).release(requestId, processingOrderId),
    reject: async (requestId, processingOrderId, reason) =>
      (await browserOnlineOrderInboxClient()).reject(requestId, processingOrderId, reason),
    accept: async (request, confirmation) => acceptanceClient().accept(request, confirmation),
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

function OnlineOrderAcceptanceForm({
  request,
  workspace,
  busy,
  onAccept,
}: {
  readonly request: CachedOnlineOrderRequest;
  readonly workspace: OrdersWorkspace;
  readonly busy: boolean;
  readonly onAccept: (
    request: CachedOnlineOrderRequest,
    confirmation: OnlineOrderAcceptanceConfirmation,
  ) => void | Promise<void>;
}) {
  const [orderTypeId, setOrderTypeId] = useState('');
  const [deliveryZoneId, setDeliveryZoneId] = useState('');
  const [finalDeliveryFee, setFinalDeliveryFee] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [cashReceived, setCashReceived] = useState('');

  const requiredBehavior = request.fulfillmentPreference === 'DELIVERY' ? 'DELIVERY' : 'TAKE_AWAY';
  const orderTypes = workspace.configuration.orderTypes.filter(
    (orderType) => orderType.active && orderType.behavior === requiredBehavior,
  );
  const deliveryZones = workspace.configuration.deliveryZones.filter((zone) => zone.active);
  const paymentMethods = workspace.configuration.paymentMethods.filter((method) => method.active);
  const selectedOrderType = orderTypes.find((orderType) => orderType.id === orderTypeId) ?? null;
  const selectedZone = deliveryZones.find((zone) => zone.id === deliveryZoneId) ?? null;
  const selectedPayment = paymentMethods.find((method) => method.id === paymentMethodId) ?? null;
  const finalFeeMinor =
    request.fulfillmentPreference === 'DELIVERY' ? parseMinorInput(finalDeliveryFee) : null;
  const cashReceivedMinor =
    selectedPayment?.logicType === 'CASH' ? parseMinorInput(cashReceived) : null;

  const deliveryReady =
    request.fulfillmentPreference === 'PICKUP' || (selectedZone !== null && finalFeeMinor !== null);
  const paymentReady =
    selectedPayment !== null &&
    (selectedPayment.logicType !== 'CASH' || cashReceivedMinor !== null);
  const canSubmit = selectedOrderType !== null && deliveryReady && paymentReady && !busy;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || selectedOrderType === null || selectedPayment === null) return;
    const confirmation: OnlineOrderAcceptanceConfirmation = {
      orderTypeId: selectedOrderType.id,
      deliveryZoneId:
        request.fulfillmentPreference === 'DELIVERY' ? (selectedZone?.id ?? null) : null,
      finalDeliveryFeeMinor: request.fulfillmentPreference === 'DELIVERY' ? finalFeeMinor : null,
      payment: {
        mode: 'SINGLE',
        methodId: selectedPayment.id,
        cashReceivedMinor: selectedPayment.logicType === 'CASH' ? cashReceivedMinor : null,
      },
    };
    void onAccept(request, confirmation);
  }

  return (
    <form className="online-order-reject-form online-order-acceptance-form" onSubmit={submit}>
      <div className="online-order-confirmed-authority">
        <span>Current operator</span>
        <strong>{workspace.operator.displayName}</strong>
        <span>Open Business Day</span>
        <strong>{workspace.businessDayId}</strong>
      </div>
      <div className="online-order-acceptance-fields">
        <label>
          Fulfillment type
          <select
            aria-label="Fulfillment type"
            value={orderTypeId}
            onChange={(event) => setOrderTypeId(event.target.value)}
          >
            <option value="">Select current POS type</option>
            {orderTypes.map((orderType) => (
              <option key={orderType.id} value={orderType.id}>
                {orderType.name}
              </option>
            ))}
          </select>
        </label>
        {request.fulfillmentPreference === 'DELIVERY' ? (
          <>
            <label>
              Delivery zone
              <select
                aria-label="Delivery zone"
                value={deliveryZoneId}
                onChange={(event) => setDeliveryZoneId(event.target.value)}
              >
                <option value="">Select current zone</option>
                {deliveryZones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name} · configured {money(zone.feeMinor)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Final delivery fee
              <input
                inputMode="decimal"
                placeholder="EGP"
                value={finalDeliveryFee}
                onChange={(event) => setFinalDeliveryFee(event.target.value)}
              />
            </label>
          </>
        ) : null}
        <label>
          Payment method
          <select
            aria-label="Payment method"
            value={paymentMethodId}
            onChange={(event) => {
              setPaymentMethodId(event.target.value);
              setCashReceived('');
            }}
          >
            <option value="">Select authoritative payment</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.displayName}
              </option>
            ))}
          </select>
        </label>
        {selectedPayment?.logicType === 'CASH' ? (
          <label>
            Cash received
            <input
              inputMode="decimal"
              placeholder="EGP received"
              value={cashReceived}
              onChange={(event) => setCashReceived(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      <p className="online-order-item-count">
        Customer payment preference is advisory only. The selected POS payment allocates the final
        canonical total.
      </p>
      <div>
        <button className="board-primary-button" type="submit" disabled={!canSubmit}>
          Accept in POS
        </button>
      </div>
    </form>
  );
}

export function OnlineOrderInboxPanel({
  snapshot,
  busyRequestId,
  onClaim,
  onRelease,
  onReject,
  acceptanceWorkspaces = {},
  acceptanceErrors = {},
  acceptedRequestIds = new Set<string>(),
  onAccept,
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
  readonly acceptanceWorkspaces?: Readonly<Record<string, OrdersWorkspace | null>>;
  readonly acceptanceErrors?: Readonly<Record<string, string | null>>;
  readonly acceptedRequestIds?: ReadonlySet<string>;
  readonly onAccept?: (
    request: CachedOnlineOrderRequest,
    confirmation: OnlineOrderAcceptanceConfirmation,
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
            const acceptanceWorkspace = acceptanceWorkspaces[request.requestId];
            const acceptanceError = acceptanceErrors[request.requestId] ?? null;
            const acceptedLocally = acceptedRequestIds.has(request.requestId);
            return (
              <article className="online-order-card" key={request.requestId}>
                <header>
                  <div>
                    <span className="online-order-status">
                      {acceptedLocally
                        ? 'Accepted locally'
                        : isProcessing
                          ? 'In review'
                          : 'Pending review'}
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
                  {request.trustedItems.length} canonical item line(s) received
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

                {acceptedLocally ? (
                  <div className="online-order-authority-note" role="status">
                    <strong>Canonical order placed locally</strong>
                    <p>The remote request will resolve through the existing Operations outbox.</p>
                  </div>
                ) : rejectingRequestId === request.requestId &&
                  request.processingOrderId !== null ? (
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
                ) : isProcessing && request.processingOrderId !== null ? (
                  <>
                    <div className="online-order-actions">
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
                    </div>
                    {acceptanceError !== null ? (
                      <div className="board-inline-error" role="alert">
                        {acceptanceError}
                      </div>
                    ) : acceptanceWorkspace === undefined ? (
                      <p className="online-order-item-count">Loading current POS authority…</p>
                    ) : acceptanceWorkspace === null || onAccept === undefined ? (
                      <p className="online-order-item-count">
                        Current POS authority is unavailable; this request cannot be accepted yet.
                      </p>
                    ) : (
                      <OnlineOrderAcceptanceForm
                        request={request}
                        workspace={acceptanceWorkspace}
                        busy={isBusy}
                        onAccept={onAccept}
                      />
                    )}
                  </>
                ) : (
                  <div className="online-order-actions">
                    <button
                      className="board-primary-button"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onClaim(request.requestId)}
                    >
                      Review
                    </button>
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
  ordersClient: providedOrdersClient,
}: {
  readonly client?: OperationsOnlineOrderInboxClient;
  readonly ordersClient?: OperationsOrdersClient;
}) {
  const client = useMemo(
    () => providedClient ?? createOperationsOnlineOrderInboxClient(),
    [providedClient],
  );
  const ordersClient = useMemo(
    () => providedOrdersClient ?? createOperationsOrdersClient(),
    [providedOrdersClient],
  );
  const [snapshot, setSnapshot] = useState<OnlineOrderInboxSnapshot>(EMPTY_SNAPSHOT);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acceptanceWorkspaces, setAcceptanceWorkspaces] = useState<
    Readonly<Record<string, OrdersWorkspace | null>>
  >({});
  const [acceptanceErrors, setAcceptanceErrors] = useState<Readonly<Record<string, string | null>>>(
    {},
  );
  const [acceptedRequestIds, setAcceptedRequestIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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

  useEffect(() => {
    let active = true;
    const processingRequests = snapshot.requests.filter(
      (request) => request.status === 'PROCESSING',
    );
    if (processingRequests.length === 0) {
      setAcceptanceWorkspaces({});
      setAcceptanceErrors({});
      return () => {
        active = false;
      };
    }

    void Promise.all(
      processingRequests.map(async (request) => {
        const result = await ordersClient.loadWorkspace(`online-order:${request.requestId}`);
        return { requestId: request.requestId, result };
      }),
    ).then((results) => {
      if (!active) return;
      const workspaces: Record<string, OrdersWorkspace | null> = {};
      const errors: Record<string, string | null> = {};
      for (const { requestId, result } of results) {
        if (result.ok) {
          workspaces[requestId] = result.value;
          errors[requestId] = null;
        } else {
          workspaces[requestId] = null;
          errors[requestId] = result.error.message;
        }
      }
      setAcceptanceWorkspaces(workspaces);
      setAcceptanceErrors(errors);
    });

    return () => {
      active = false;
    };
  }, [ordersClient, snapshot.requests]);

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

  async function accept(
    request: CachedOnlineOrderRequest,
    confirmation: OnlineOrderAcceptanceConfirmation,
  ): Promise<void> {
    await run(request.requestId, async () => {
      const result = await client.accept(request, confirmation);
      if (!result.ok) throw new Error(result.error.message);
      setAcceptedRequestIds((current) => new Set(current).add(request.requestId));
      return result;
    });
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
        acceptanceWorkspaces={acceptanceWorkspaces}
        acceptanceErrors={acceptanceErrors}
        acceptedRequestIds={acceptedRequestIds}
        onClaim={(requestId) => run(requestId, () => client.claim(requestId))}
        onRelease={(requestId, processingOrderId) =>
          run(requestId, () => client.release(requestId, processingOrderId))
        }
        onReject={(requestId, processingOrderId, reason) =>
          run(requestId, () => client.reject(requestId, processingOrderId, reason))
        }
        onAccept={accept}
      />
    </>
  );
}
