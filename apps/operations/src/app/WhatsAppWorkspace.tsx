import type { WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import type { WhatsAppInboxController, WhatsAppInboxUiState } from './whatsappInboxController';
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
  | 'setComposerText'
  | 'sendCurrentText'
  | 'markUnread'
  | 'setArchived'
  | 'setFollowUp'
>;

interface WhatsAppWorkspaceProps {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
}

const FILTERS: readonly { value: WhatsAppInboxFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNREAD', label: 'Unread' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'ARCHIVED', label: 'Archived' },
];

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
      onClick={onSelect}
    >
      <span className="whatsapp-conversation-row-heading">
        <strong>{whatsAppConversationDisplayName(conversation)}</strong>
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

function MessageBubble({ message }: { readonly message: WhatsAppMessage }) {
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
      ) : (
        <p className="whatsapp-message-placeholder">{whatsAppMessageKindLabel(message.kind)}</p>
      )}
      {message.direction === 'OUTBOUND' && !system ? (
        <span
          className={`whatsapp-message-status whatsapp-message-status-${message.status.toLowerCase()}`}
        >
          {whatsAppStatusLabel(message.status)}
        </span>
      ) : null}
    </article>
  );
}

function ConversationPanel({
  controller,
  state,
  conversation,
}: {
  readonly controller: WhatsAppWorkspaceController;
  readonly state: WhatsAppInboxUiState;
  readonly conversation: WhatsAppConversation | null;
}) {
  if (conversation === null) {
    return (
      <section className="whatsapp-conversation-panel whatsapp-conversation-panel-empty">
        <div>
          <h2>No conversation selected</h2>
          <p>Choose a conversation from the inbox rail.</p>
        </div>
      </section>
    );
  }

  const quickReplies = sortActiveQuickReplies(state.snapshot?.quickReplies ?? []);

  return (
    <section className="whatsapp-conversation-panel" aria-label="Active WhatsApp conversation">
      <header className="whatsapp-conversation-header">
        <div className="whatsapp-conversation-identity">
          <div>
            <p className="eyebrow">{whatsAppConversationLabel(conversation)}</p>
            <h2>{whatsAppConversationDisplayName(conversation)}</h2>
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
          <button
            type="button"
            className="secondary-action"
            data-whatsapp-action="archive"
            onClick={() => void controller.setArchived(conversation.id, !conversation.archived)}
          >
            {conversation.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            className="secondary-action"
            data-whatsapp-action="mark-unread"
            onClick={() => void controller.markUnread(conversation.id)}
          >
            Mark unread
          </button>
        </div>
      </header>

      <div className="whatsapp-message-history" aria-label="Message history">
        {state.selectedMessages.length === 0 ? (
          <p className="whatsapp-empty-copy">No loaded messages in this conversation.</p>
        ) : (
          state.selectedMessages.map((item) => <MessageBubble key={item.id} message={item} />)
        )}
      </div>

      <div className="whatsapp-composer-zone">
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
        </div>
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
          <span className="whatsapp-explicit-send-note">Messages send only when you press Send.</span>
          <button
            type="button"
            className="primary-action whatsapp-send-action"
            data-whatsapp-send={true}
            disabled={state.sendBusy || state.composerText.trim().length === 0}
            onClick={() => void controller.sendCurrentText()}
          >
            {state.sendBusy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function WhatsAppWorkspace({ controller, state }: WhatsAppWorkspaceProps) {
  const snapshotMessages = state.snapshot?.messages ?? [];
  const selectedConversation =
    state.selectedConversationId === null
      ? null
      : (state.snapshot?.conversations.find(
          (conversation) => conversation.id === state.selectedConversationId,
        ) ?? null);

  return (
    <section className="whatsapp-workspace" aria-label="WhatsApp inbox">
      <aside className="whatsapp-conversation-rail">
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

        <div className="whatsapp-conversation-list" aria-label="Conversations">
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

      {ConversationPanel({ controller, state, conversation: selectedConversation })}
    </section>
  );
}
