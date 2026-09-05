import type { WhatsAppCustomerOrderContext } from '@tux/application';
import type { OrderId, WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import type { WhatsAppInboxController, WhatsAppInboxUiState } from './whatsappInboxController';
import { presentWhatsAppOrderContext } from './whatsappOrderContext';
import {
  lastMessagePreview,
  sortActiveQuickReplies,
  whatsAppConversationDisplayName,
  whatsAppConversationLabel,
  whatsAppMessageKindLabel,
  whatsAppStatusLabel,
  type WhatsAppInboxFilter,
} from './whatsappView';

export type WhatsAppWorkspaceController = Pick<
  WhatsAppInboxController,
  | 'setFilter'
  | 'setSearch'
  | 'selectConversation'
  | 'insertQuickReply'
  | 'insertMenuReply'
  | 'sendSelectedTemplate'
  | 'setComposerText'
  | 'sendCurrentText'
  | 'selectMediaFile'
  | 'sendCurrentMedia'
  | 'cancelMedia'
  | 'startVoiceRecording'
  | 'stopVoiceRecording'
  | 'sendStoreLocation'
  | 'sendCurrentLocation'
  | 'retryFailedMessage'
  | 'loadMediaAccess'
  | 'markUnread'
  | 'setArchived'
  | 'setFollowUp'
  | 'linkSelectedOrder'
>;

interface WhatsAppWorkspaceProps {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
  readonly onCreateOrderFromChat?: (context: WhatsAppCustomerOrderContext) => void;
  readonly onViewOrder?: (orderId: OrderId) => void;
}

const FILTERS: readonly { value: WhatsAppInboxFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNREAD', label: 'Unread' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const MEDIA_ACCEPT = [
  'image/jpeg',
  'image/png',
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

function formatConversationTime(value: WhatsAppConversation['lastMessageAt']): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ConversationRow({
  conversation,
  messages,
  selected,
  onSelect,
}: {
  readonly conversation: WhatsAppConversation;
  readonly messages: readonly WhatsAppMessage[];
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const preview = lastMessagePreview(conversation, messages);
  const time = formatConversationTime(conversation.lastMessageAt);

  return (
    <button
      key={conversation.id}
      type="button"
      className={
        selected
          ? 'whatsapp-conversation-row whatsapp-conversation-row-selected'
          : 'whatsapp-conversation-row'
      }
      data-conversation-id={conversation.id}
      aria-pressed={selected}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <span className="whatsapp-conversation-row-heading">
        <strong dir="auto">{whatsAppConversationDisplayName(conversation)}</strong>
        {time === null ? null : <time dateTime={String(conversation.lastMessageAt)}>{time}</time>}
      </span>
      <span className="whatsapp-conversation-context">
        {whatsAppConversationLabel(conversation)}
      </span>
      <span className="whatsapp-conversation-row-footer">
        <span className="whatsapp-conversation-preview" dir="auto">
          {preview ?? 'No loaded messages'}
        </span>
        <span className="whatsapp-conversation-indicators">
          {conversation.followUp ? (
            <span className="whatsapp-follow-up-indicator">Follow-up</span>
          ) : null}
          {conversation.unreadCount > 0 ? (
            <span
              className="whatsapp-conversation-unread"
              aria-label={`${conversation.unreadCount} unread`}
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function BinaryMessageContent({
  message,
  state,
  controller,
}: {
  readonly message: WhatsAppMessage;
  readonly state: WhatsAppInboxUiState;
  readonly controller: WhatsAppWorkspaceController;
}) {
  if (message.kind !== 'IMAGE' && message.kind !== 'DOCUMENT' && message.kind !== 'AUDIO') {
    return null;
  }

  const media = message.media;
  const label = whatsAppMessageKindLabel(message.kind);
  if (media === null || media === undefined) {
    return <p className="whatsapp-message-placeholder">{label}</p>;
  }

  const access = state.mediaAccessByMessageId?.[message.id];
  const expired = media.availability === 'EXPIRED' || access?.availability === 'EXPIRED';

  if (expired) {
    return (
      <div className="whatsapp-message-media whatsapp-message-media-expired">
        <span>{label}</span>
        {media.fileName === null ? null : <span dir="auto">{media.fileName}</span>}
        <strong>Media expired</strong>
      </div>
    );
  }

  if (access?.availability !== 'AVAILABLE' || access.url === null) {
    return (
      <div className="whatsapp-message-media">
        <span>{label}</span>
        {media.fileName === null ? null : <span dir="auto">{media.fileName}</span>}
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-load-media={message.id}
          onClick={() => void controller.loadMediaAccess(message.id)}
        >
          Load media
        </button>
      </div>
    );
  }

  if (message.kind === 'IMAGE') {
    return (
      <figure className="whatsapp-message-media">
        <img
          src={access.url}
          alt={media.fileName ?? 'WhatsApp image'}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        {media.fileName === null ? null : <figcaption dir="auto">{media.fileName}</figcaption>}
      </figure>
    );
  }

  if (message.kind === 'AUDIO') {
    return (
      <div className="whatsapp-message-media">
        <audio controls preload="none" src={access.url} />
      </div>
    );
  }

  return (
    <div className="whatsapp-message-media">
      <a href={access.url} download={media.fileName ?? undefined} rel="noreferrer">
        {media.fileName ?? 'Document'}
      </a>
    </div>
  );
}

function MessageBubble({
  message,
  state,
  controller,
}: {
  readonly message: WhatsAppMessage;
  readonly state: WhatsAppInboxUiState;
  readonly controller: WhatsAppWorkspaceController;
}) {
  const system = message.kind === 'SYSTEM';
  const className = system
    ? 'whatsapp-message whatsapp-message-system'
    : message.direction === 'OUTBOUND'
      ? 'whatsapp-message whatsapp-message-outbound'
      : 'whatsapp-message whatsapp-message-inbound';

  return (
    <article className={className} data-message-kind={message.kind}>
      {message.kind === 'TEXT' ? (
        <p dir="auto" className="whatsapp-message-text">
          {message.text ?? ''}
        </p>
      ) : message.kind === 'SYSTEM' && message.text !== null ? (
        <p dir="auto" className="whatsapp-message-text">
          {message.text}
        </p>
      ) : message.kind === 'LOCATION' && message.location !== null ? (
        <div className="whatsapp-message-location">
          {message.location.name === null ? null : (
            <strong dir="auto">{message.location.name}</strong>
          )}
          {message.location.address === null ? null : (
            <span dir="auto">{message.location.address}</span>
          )}
          <span dir="ltr">
            {message.location.latitude}, {message.location.longitude}
          </span>
        </div>
      ) : message.kind === 'IMAGE' || message.kind === 'DOCUMENT' || message.kind === 'AUDIO' ? (
        BinaryMessageContent({ message, state, controller })
      ) : (
        <p className="whatsapp-message-placeholder">{whatsAppMessageKindLabel(message.kind)}</p>
      )}
      {message.direction === 'OUTBOUND' && !system ? (
        <div className="whatsapp-message-delivery">
          <span
            className={`whatsapp-message-status whatsapp-message-status-${message.status.toLowerCase()}`}
          >
            {whatsAppStatusLabel(message.status)}
          </span>
          {message.status === 'FAILED' ? (
            <button
              type="button"
              className="quiet-action"
              data-whatsapp-retry-message={message.id}
              disabled={state.sendBusy}
              onClick={() => void controller.retryFailedMessage(message.id)}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CustomerOrderContextCard({
  controller,
  state,
  conversation,
  onCreateOrderFromChat,
  onViewOrder,
}: {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
  readonly conversation: WhatsAppConversation;
  readonly onCreateOrderFromChat: ((context: WhatsAppCustomerOrderContext) => void) | undefined;
  readonly onViewOrder: ((orderId: OrderId) => void) | undefined;
}) {
  if (state.contextBusy && state.customerOrderContext === null) {
    return (
      <section
        className="whatsapp-order-context whatsapp-order-context-loading"
        data-whatsapp-region="customer-order-context"
        aria-label="Customer and order context"
      >
        <span className="whatsapp-empty-copy">Loading customer / order context…</span>
      </section>
    );
  }

  if (state.customerOrderContext === null) return null;

  const presentation = presentWhatsAppOrderContext(
    state.customerOrderContext,
    conversation.linkedOrderId,
  );

  const renderOrder = (order: (typeof presentation.candidates)[number]) => (
    <div className="whatsapp-order-context-order" key={order.id}>
      <div className="whatsapp-order-context-order-copy">
        <strong>{order.displayLabel}</strong>
        <span>{order.orderTypeLabel}</span>
        <span>{order.linked ? 'Linked' : 'Not linked'}</span>
      </div>
      <div className="whatsapp-order-context-actions">
        {onViewOrder === undefined ? null : (
          <button type="button" className="quiet-action" onClick={() => onViewOrder(order.id)}>
            View Order
          </button>
        )}
        <button
          type="button"
          className="secondary-action"
          onClick={() => void controller.linkSelectedOrder(order.id, !order.linked)}
        >
          {order.linked ? 'Unlink' : 'Link'}
        </button>
      </div>
    </div>
  );

  return (
    <section
      className="whatsapp-order-context"
      data-whatsapp-region="customer-order-context"
      aria-label="Customer and order context"
    >
      <div className="whatsapp-order-context-heading">
        <div>
          <p className="eyebrow">Customer / Order</p>
          <strong dir="auto">{presentation.customerName}</strong>
        </div>
        <button
          type="button"
          className="secondary-action"
          disabled={onCreateOrderFromChat === undefined}
          onClick={() => onCreateOrderFromChat?.(state.customerOrderContext!)}
        >
          Create Order from Chat
        </button>
      </div>

      <div className="whatsapp-order-context-customer">
        <span dir="ltr">{presentation.displayPhone}</span>
        {presentation.address === null ? null : <span dir="auto">{presentation.address}</span>}
      </div>

      {presentation.activeOrderCount === 0 ? (
        <p className="whatsapp-empty-copy">No active delivery order for this business day.</p>
      ) : presentation.primaryOrder !== null ? (
        renderOrder(presentation.primaryOrder)
      ) : (
        <div className="whatsapp-order-context-candidates">
          <p className="whatsapp-order-context-guidance">Choose an order explicitly</p>
          {presentation.candidates.map(renderOrder)}
        </div>
      )}
    </section>
  );
}

function FreeFormMediaComposer({
  controller,
  state,
}: {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
}) {
  const mediaState = state.mediaComposerState ?? { kind: 'IDLE' as const };
  const fileControls = (
    <>
      <label className="quiet-action whatsapp-media-file-action">
        Attachment
        <input
          type="file"
          accept={MEDIA_ACCEPT}
          data-whatsapp-attachment={true}
          disabled={state.sendBusy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file === undefined) return;
            void file.arrayBuffer().then((buffer) => {
              controller.selectMediaFile({
                bytes: new Uint8Array(buffer),
                mimeType: file.type,
                fileName: file.name,
              });
            });
          }}
        />
      </label>
      <button
        type="button"
        className="quiet-action"
        data-whatsapp-record-voice={true}
        disabled={state.sendBusy}
        onClick={() => void controller.startVoiceRecording()}
      >
        Record voice
      </button>
    </>
  );

  let mediaPreview = null;
  if (mediaState.kind === 'FILE_READY') {
    mediaPreview = (
      <div className="whatsapp-media-composer-preview">
        {mediaState.previewUrl === null ? null : mediaState.mediaKind === 'IMAGE' ? (
          <img src={mediaState.previewUrl} alt="Attachment preview" />
        ) : mediaState.mediaKind === 'AUDIO' ? (
          <audio controls src={mediaState.previewUrl} />
        ) : null}
        <span dir="auto">{mediaState.fileName}</span>
        <button
          type="button"
          className="primary-action"
          data-whatsapp-send-media={true}
          disabled={state.sendBusy}
          onClick={() => void controller.sendCurrentMedia()}
        >
          Send attachment
        </button>
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-cancel-media={true}
          disabled={state.sendBusy}
          onClick={() => controller.cancelMedia()}
        >
          Cancel
        </button>
      </div>
    );
  } else if (mediaState.kind === 'RECORDING') {
    mediaPreview = (
      <div className="whatsapp-media-composer-preview" role="status">
        <strong>Recording…</strong>
        <button
          type="button"
          className="primary-action"
          data-whatsapp-stop-voice={true}
          onClick={() => void controller.stopVoiceRecording()}
        >
          Stop recording
        </button>
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-cancel-media={true}
          onClick={() => controller.cancelMedia()}
        >
          Cancel
        </button>
      </div>
    );
  } else if (mediaState.kind === 'AUDIO_READY') {
    mediaPreview = (
      <div className="whatsapp-media-composer-preview">
        <audio controls src={mediaState.previewUrl} />
        <button
          type="button"
          className="primary-action"
          data-whatsapp-send-media={true}
          disabled={state.sendBusy}
          onClick={() => void controller.sendCurrentMedia()}
        >
          Send voice
        </button>
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-cancel-media={true}
          disabled={state.sendBusy}
          onClick={() => controller.cancelMedia()}
        >
          Cancel
        </button>
      </div>
    );
  } else if (mediaState.kind === 'ERROR') {
    mediaPreview = (
      <div className="whatsapp-media-composer-preview">
        <span role="alert">{mediaState.message}</span>
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-cancel-media={true}
          onClick={() => controller.cancelMedia()}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="whatsapp-media-composer" aria-label="WhatsApp media and location">
      {mediaState.kind === 'RECORDING' || mediaState.kind === 'AUDIO_READY' ? null : (
        <div className="whatsapp-media-composer-actions">{fileControls}</div>
      )}
      {mediaPreview}
      <div className="whatsapp-media-composer-actions">
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-store-location={true}
          disabled={state.sendBusy || state.messagingTarget?.config.storeLocation === null}
          onClick={() => void controller.sendStoreLocation()}
        >
          Store Location
        </button>
        <button
          type="button"
          className="quiet-action"
          data-whatsapp-current-location={true}
          disabled={state.sendBusy}
          onClick={() => void controller.sendCurrentLocation()}
        >
          Current Location
        </button>
      </div>
    </div>
  );
}

function ConversationPanel({
  controller,
  state,
  conversation,
  onCreateOrderFromChat,
  onViewOrder,
}: {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
  readonly conversation: WhatsAppConversation | null;
  readonly onCreateOrderFromChat: ((context: WhatsAppCustomerOrderContext) => void) | undefined;
  readonly onViewOrder: ((orderId: OrderId) => void) | undefined;
}) {
  if (conversation === null) {
    return (
      <section
        className="whatsapp-conversation-panel whatsapp-conversation-panel-empty"
        data-whatsapp-pane="detail"
      >
        <div>
          <h2>No conversation selected</h2>
          <p>Choose a conversation from the inbox rail.</p>
        </div>
      </section>
    );
  }

  const quickReplies = sortActiveQuickReplies(state.snapshot?.quickReplies ?? []);

  return (
    <section
      className="whatsapp-conversation-panel"
      aria-label="Active WhatsApp conversation"
      data-whatsapp-pane="detail"
    >
      <header className="whatsapp-conversation-header" data-whatsapp-region="conversation-header">
        <div className="whatsapp-conversation-identity">
          <div>
            <p className="eyebrow">{whatsAppConversationLabel(conversation)}</p>
            <h2 dir="auto">{whatsAppConversationDisplayName(conversation)}</h2>
          </div>
          <p>{conversation.displayPhone}</p>
          {conversation.linkedOrderId === null ? null : (
            <span className="whatsapp-linked-order-indicator">Order linked</span>
          )}
        </div>
        <div className="whatsapp-conversation-actions" aria-label="Conversation actions">
          <button
            type="button"
            className="secondary-action"
            data-whatsapp-action="follow-up"
            onClick={() => void controller.setFollowUp(conversation.id, !conversation.followUp)}
          >
            {conversation.followUp ? 'Remove follow-up' : 'Follow-up'}
          </button>
          <details className="whatsapp-conversation-overflow" data-whatsapp-overflow={true}>
            <summary aria-label="More conversation actions">…</summary>
            <div className="whatsapp-conversation-overflow-menu">
              <button
                type="button"
                className="quiet-action"
                data-whatsapp-action="archive"
                onClick={() => void controller.setArchived(conversation.id, !conversation.archived)}
              >
                {conversation.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                className="quiet-action"
                data-whatsapp-action="mark-unread"
                onClick={() => void controller.markUnread(conversation.id)}
              >
                Mark unread
              </button>
            </div>
          </details>
        </div>
      </header>

      <CustomerOrderContextCard
        controller={controller}
        state={state}
        conversation={conversation}
        onCreateOrderFromChat={onCreateOrderFromChat}
        onViewOrder={onViewOrder}
      />

      <div
        className="whatsapp-message-history"
        aria-label="Message history"
        data-whatsapp-region="message-history"
      >
        {state.selectedMessages.length === 0 ? (
          <p className="whatsapp-empty-copy">No loaded messages in this conversation.</p>
        ) : (
          state.selectedMessages.map((item) => MessageBubble({ message: item, state, controller }))
        )}
      </div>

      {state.messagingTarget?.mode === 'BLOCKED' ? (
        <div
          className="whatsapp-composer-zone whatsapp-policy-blocked"
          data-whatsapp-region="composer"
          data-whatsapp-policy="BLOCKED"
          role="status"
        >
          <strong>Messaging unavailable</strong>
          <span>No approved WhatsApp template is available for this customer right now.</span>
        </div>
      ) : state.messagingTarget?.mode === 'TEMPLATE_ONLY' ? (
        <div
          className="whatsapp-composer-zone whatsapp-policy-template-only"
          data-whatsapp-region="composer"
          data-whatsapp-policy="TEMPLATE_ONLY"
        >
          <div className="whatsapp-policy-note" role="status">
            The free-form messaging window is closed. Choose an approved template to restart chat.
          </div>
          <div className="whatsapp-template-list" aria-label="Approved WhatsApp templates">
            {state.messagingTarget.templates.length === 0 ? (
              <span className="whatsapp-empty-copy">
                No approved WhatsApp template is available.
              </span>
            ) : (
              state.messagingTarget.templates.map((template) => (
                <button
                  type="button"
                  className="whatsapp-template-action"
                  key={template.id}
                  data-template-id={template.id}
                  disabled={state.sendBusy}
                  onClick={() => void controller.sendSelectedTemplate(template.id)}
                >
                  <strong>{template.label}</strong>
                  <span dir="auto">{template.previewText}</span>
                </button>
              ))
            )}
          </div>
          <label className="whatsapp-composer-label" htmlFor="whatsapp-composer">
            Saved draft
          </label>
          <textarea
            id="whatsapp-composer"
            className="whatsapp-composer"
            data-whatsapp-composer={true}
            rows={3}
            value={state.composerText}
            disabled={true}
            readOnly={true}
            aria-describedby="whatsapp-template-only-note"
          />
          <span id="whatsapp-template-only-note" className="whatsapp-explicit-send-note">
            Your draft is preserved until free-form messaging is available again.
          </span>
        </div>
      ) : (
        <div
          className="whatsapp-composer-zone"
          data-whatsapp-region="composer"
          data-whatsapp-policy="FREE_FORM"
        >
          <div className="whatsapp-quick-replies" aria-label="Quick replies">
            {quickReplies.length === 0 ? (
              <span className="whatsapp-empty-copy">No saved quick replies.</span>
            ) : (
              quickReplies.map((reply) => (
                <button
                  type="button"
                  className="whatsapp-quick-reply"
                  key={reply.id}
                  data-quick-reply-id={reply.id}
                  onClick={() => controller.insertQuickReply(reply.text)}
                >
                  {reply.text}
                </button>
              ))
            )}
            <button
              type="button"
              className="whatsapp-quick-reply"
              data-whatsapp-send-menu={true}
              disabled={state.messagingTarget === null}
              onClick={() => controller.insertMenuReply()}
            >
              Send Menu
            </button>
          </div>
          {state.networkOffline ? null : FreeFormMediaComposer({ controller, state })}
          <label className="whatsapp-composer-label" htmlFor="whatsapp-composer">
            Message
          </label>
          <textarea
            id="whatsapp-composer"
            className="whatsapp-composer"
            data-whatsapp-composer={true}
            rows={3}
            value={state.composerText}
            onChange={(event) => controller.setComposerText(event.target.value)}
            placeholder="Write a WhatsApp message"
          />
          <div className="whatsapp-composer-footer">
            <span className="whatsapp-explicit-send-note">
              Messages send only when you press Send.
            </span>
            <button
              type="button"
              className="primary-action whatsapp-send-action"
              data-whatsapp-send={true}
              disabled={
                state.messagingTarget?.mode !== 'FREE_FORM' ||
                state.sendBusy ||
                state.composerText.trim().length === 0
              }
              onClick={() => void controller.sendCurrentText()}
            >
              {state.sendBusy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WhatsAppWorkspace({
  controller,
  state,
  onCreateOrderFromChat,
  onViewOrder,
}: WhatsAppWorkspaceProps) {
  const snapshotMessages = state.snapshot?.messages ?? [];
  const selectedConversation =
    state.selectedConversationId === null
      ? null
      : (state.snapshot?.conversations.find(
          (conversation) => conversation.id === state.selectedConversationId,
        ) ?? null);

  return (
    <section className="whatsapp-workspace" aria-label="WhatsApp inbox">
      <aside className="whatsapp-conversation-rail" data-whatsapp-pane="rail">
        <header className="whatsapp-rail-heading">
          <div>
            <p className="eyebrow">Worker inbox</p>
            <h1>WhatsApp</h1>
          </div>
          {state.refreshing ? <span className="whatsapp-refreshing">Refreshing…</span> : null}
        </header>

        {state.networkOffline ? (
          <p className="whatsapp-network-advisory" role="status">
            Network offline — cached WhatsApp may be stale. POS continues normally.
          </p>
        ) : null}
        {state.errorMessage === null ? null : (
          <p className="whatsapp-error" role="alert">
            {state.errorMessage}
          </p>
        )}

        <label className="whatsapp-search-label" htmlFor="whatsapp-search">
          Search
        </label>
        <input
          id="whatsapp-search"
          className="whatsapp-search"
          data-whatsapp-search={true}
          type="search"
          value={state.search}
          placeholder="Search conversations"
          onChange={(event) => controller.setSearch(event.target.value)}
        />

        <div className="whatsapp-filters" role="group" aria-label="Inbox filters">
          {FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.value}
              data-whatsapp-filter={filter.value}
              className={
                state.filter === filter.value
                  ? 'whatsapp-filter whatsapp-filter-active'
                  : 'whatsapp-filter'
              }
              aria-pressed={state.filter === filter.value}
              onClick={() => controller.setFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div
          className="whatsapp-conversation-list"
          aria-label="Conversations"
          data-whatsapp-region="conversation-list"
        >
          {state.visibleConversations.length === 0 ? (
            <p className="whatsapp-empty-copy">No conversations match this view.</p>
          ) : (
            state.visibleConversations.map((conversation) =>
              ConversationRow({
                conversation,
                messages: snapshotMessages,
                selected: conversation.id === state.selectedConversationId,
                onSelect: () => void controller.selectConversation(conversation.id),
              }),
            )
          )}
        </div>
      </aside>

      {ConversationPanel({
        controller,
        state,
        conversation: selectedConversation,
        onCreateOrderFromChat,
        onViewOrder,
      })}
    </section>
  );
}
