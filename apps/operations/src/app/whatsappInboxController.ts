import type { WhatsAppInboxSnapshot } from '@tux/application';
import type { WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';
import {
  filterAndSortWhatsAppConversations,
  insertQuickReply as insertQuickReplyText,
  totalUnreadCount,
  type WhatsAppInboxFilter,
} from './whatsappView';

const POLL_INTERVAL_MS = 15_000;
const DRAFT_DEBOUNCE_MS = 250;

export interface WhatsAppInboxUiState {
  readonly snapshot: WhatsAppInboxSnapshot | null;
  readonly visibleConversations: readonly WhatsAppConversation[];
  readonly selectedConversationId: string | null;
  readonly selectedMessages: readonly WhatsAppMessage[];
  readonly filter: WhatsAppInboxFilter;
  readonly search: string;
  readonly totalUnread: number;
  readonly refreshing: boolean;
  readonly networkOffline: boolean;
  readonly lastRefreshedAt: number | null;
  readonly errorMessage: string | null;
  readonly composerText: string;
  readonly sendBusy: boolean;
}

export interface WhatsAppInboxControllerEnvironment {
  readonly nowMs: () => number;
  readonly createIntentKey: () => string;
  readonly setInterval: (callback: () => void, intervalMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly isDocumentHidden: () => boolean;
  readonly isOnline: () => boolean;
  readonly addVisibilityListener: (listener: () => void) => () => void;
  readonly addOnlineListener: (listener: () => void) => () => void;
  readonly addOfflineListener: (listener: () => void) => () => void;
}

interface PendingDraft {
  readonly conversationId: string;
  readonly text: string;
}

interface SendAttempt {
  readonly conversationId: string;
  readonly text: string;
  readonly outboundIntentKey: string;
}

export function createBrowserWhatsAppInboxEnvironment(): WhatsAppInboxControllerEnvironment {
  return {
    nowMs: () => Date.now(),
    createIntentKey: () => crypto.randomUUID(),
    setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    isDocumentHidden: () => document.hidden,
    isOnline: () => navigator.onLine,
    addVisibilityListener: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    addOnlineListener: (listener) => {
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
    addOfflineListener: (listener) => {
      window.addEventListener('offline', listener);
      return () => window.removeEventListener('offline', listener);
    },
  };
}

export class WhatsAppInboxController {
  readonly #client: TuxWhatsAppApi;
  readonly #environment: WhatsAppInboxControllerEnvironment;
  readonly #listeners = new Set<(state: WhatsAppInboxUiState) => void>();

  #state: WhatsAppInboxUiState;
  #started = false;
  #intervalHandle: unknown = null;
  #removeVisibilityListener: (() => void) | null = null;
  #removeOnlineListener: (() => void) | null = null;
  #removeOfflineListener: (() => void) | null = null;

  #refreshPromise: Promise<void> | null = null;
  #refreshPending = false;

  #selectionGeneration = 0;

  #draftTimer: unknown = null;
  #pendingDraft: PendingDraft | null = null;
  #draftSavePromise: Promise<boolean> | null = null;

  #sendAttempt: SendAttempt | null = null;

  constructor(client: TuxWhatsAppApi, environment: WhatsAppInboxControllerEnvironment) {
    this.#client = client;
    this.#environment = environment;
    this.#state = {
      snapshot: null,
      visibleConversations: [],
      selectedConversationId: null,
      selectedMessages: [],
      filter: 'ALL',
      search: '',
      totalUnread: 0,
      refreshing: false,
      networkOffline: !environment.isOnline(),
      lastRefreshedAt: null,
      errorMessage: null,
      composerText: '',
      sendBusy: false,
    };
  }

  getState(): WhatsAppInboxUiState {
    return this.#state;
  }

  subscribe(listener: (state: WhatsAppInboxUiState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#publish({ networkOffline: !this.#environment.isOnline() });

    this.#removeVisibilityListener = this.#environment.addVisibilityListener(() => {
      if (!this.#environment.isDocumentHidden() && this.#environment.isOnline()) {
        void this.refresh();
      }
    });
    this.#removeOnlineListener = this.#environment.addOnlineListener(() => {
      this.#publish({ networkOffline: false });
      void this.refresh();
    });
    this.#removeOfflineListener = this.#environment.addOfflineListener(() => {
      this.#publish({ networkOffline: true });
    });

    this.#intervalHandle = this.#environment.setInterval(() => {
      if (!this.#environment.isDocumentHidden() && this.#environment.isOnline()) {
        void this.refresh();
      }
    }, POLL_INTERVAL_MS);

    void this.refresh();
  }

  stop(): void {
    if (this.#draftTimer !== null) {
      this.#environment.clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
    }
    void this.#flushPendingDraft();

    if (!this.#started) return;
    this.#started = false;
    this.#refreshPending = false;

    if (this.#intervalHandle !== null) {
      this.#environment.clearInterval(this.#intervalHandle);
      this.#intervalHandle = null;
    }

    this.#removeVisibilityListener?.();
    this.#removeOnlineListener?.();
    this.#removeOfflineListener?.();
    this.#removeVisibilityListener = null;
    this.#removeOnlineListener = null;
    this.#removeOfflineListener = null;
  }

  refresh(): Promise<void> {
    this.#refreshPending = true;

    if (this.#refreshPromise !== null) {
      return this.#refreshPromise;
    }

    const refreshPromise = this.#drainRefreshes();
    this.#refreshPromise = refreshPromise;
    void refreshPromise.finally(() => {
      if (this.#refreshPromise === refreshPromise) {
        this.#refreshPromise = null;
      }
    });
    return refreshPromise;
  }

  onAreaSelected(): void {
    if (this.#environment.isOnline() || this.#state.snapshot === null) {
      void this.refresh();
    }
  }

  setFilter(filter: WhatsAppInboxFilter): void {
    if (this.#state.filter === filter) return;
    this.#publish({ filter });
    void this.#recomputeVisibleAndSelection();
  }

  setSearch(search: string): void {
    if (this.#state.search === search) return;
    this.#publish({ search });
    void this.#recomputeVisibleAndSelection();
  }

  async selectConversation(conversationId: string): Promise<void> {
    if (!this.#state.snapshot?.conversations.some((item) => item.id === conversationId)) return;

    const previousConversationId = this.#state.selectedConversationId;
    if (!(await this.#flushPendingDraft())) return;

    if (!this.#state.snapshot?.conversations.some((item) => item.id === conversationId)) return;

    const generation = ++this.#selectionGeneration;
    if (previousConversationId !== conversationId) {
      this.#sendAttempt = null;
    }

    this.#publish({
      selectedConversationId: conversationId,
      ...(previousConversationId === conversationId
        ? {}
        : { selectedMessages: [], composerText: '' }),
    });

    const [messagesResult, draftResult] = await Promise.all([
      this.#client.loadConversation(conversationId),
      this.#client.getDraft(conversationId),
    ]);

    if (!this.#selectionIsCurrent(generation, conversationId)) return;

    if (messagesResult.ok) {
      this.#publish({ selectedMessages: [...messagesResult.value] });
    } else {
      this.#publish({ errorMessage: messagesResult.error.message });
    }

    if (!this.#selectionIsCurrent(generation, conversationId)) return;

    if (draftResult.ok) {
      const text = draftResult.value?.text ?? '';
      if (
        this.#sendAttempt !== null &&
        (this.#sendAttempt.conversationId !== conversationId || this.#sendAttempt.text !== text)
      ) {
        this.#sendAttempt = null;
      }
      this.#publish({ composerText: text });
    } else {
      this.#publish({ errorMessage: draftResult.error.message });
    }
  }

  setComposerText(text: string): void {
    const conversationId = this.#state.selectedConversationId;

    if (
      this.#sendAttempt !== null &&
      (this.#sendAttempt.conversationId !== conversationId || this.#sendAttempt.text !== text)
    ) {
      this.#sendAttempt = null;
    }

    this.#publish({ composerText: text });

    if (this.#draftTimer !== null) {
      this.#environment.clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
    }

    if (conversationId === null) {
      this.#pendingDraft = null;
      return;
    }

    const pending: PendingDraft = { conversationId, text };
    this.#pendingDraft = pending;
    this.#draftTimer = this.#environment.setTimeout(() => {
      this.#draftTimer = null;
      if (this.#pendingDraft !== pending) return;
      this.#pendingDraft = null;
      void this.#savePendingDraft(pending);
    }, DRAFT_DEBOUNCE_MS);
  }

  insertQuickReply(text: string): void {
    this.setComposerText(insertQuickReplyText(this.#state.composerText, text));
  }

  async sendCurrentText(): Promise<void> {
    const initialConversationId = this.#state.selectedConversationId;
    const initialText = this.#state.composerText;

    if (initialConversationId === null || this.#state.sendBusy || initialText.trim().length === 0) {
      return;
    }

    if (!(await this.#flushPendingDraft())) return;

    if (
      this.#state.selectedConversationId !== initialConversationId ||
      this.#state.composerText !== initialText ||
      this.#state.sendBusy
    ) {
      return;
    }

    const attempt =
      this.#sendAttempt?.conversationId === initialConversationId &&
      this.#sendAttempt.text === initialText
        ? this.#sendAttempt
        : {
            conversationId: initialConversationId,
            text: initialText,
            outboundIntentKey: this.#environment.createIntentKey(),
          };

    this.#sendAttempt = attempt;
    this.#publish({ sendBusy: true, errorMessage: null });

    let result: Awaited<ReturnType<TuxWhatsAppApi['sendText']>>;
    try {
      result = await this.#client.sendText({
        conversationId: attempt.conversationId,
        text: attempt.text,
        outboundIntentKey: attempt.outboundIntentKey,
      });
    } catch {
      this.#publish({ sendBusy: false });
      if (this.#sendVisualContextMatches(attempt)) {
        this.#publish({ errorMessage: 'WhatsApp send failed.' });
      }
      return;
    }

    this.#publish({ sendBusy: false });

    if (!result.ok) {
      if (this.#sendVisualContextMatches(attempt)) {
        this.#publish({ errorMessage: result.error.message });
      }
      return;
    }

    const matchingVisualAttempt = this.#sendVisualContextMatches(attempt);
    if (matchingVisualAttempt) {
      this.#sendAttempt = null;
      this.#publish({ composerText: '' });
    }

    let draftClearError: string | null = null;
    const selectedConversationId = this.#state.selectedConversationId;
    const selectedText = this.#state.composerText;
    const mayClearPersistedDraft =
      selectedConversationId !== attempt.conversationId ||
      (matchingVisualAttempt && selectedText === '');

    if (mayClearPersistedDraft) {
      try {
        const draftResult = await this.#client.saveDraft(attempt.conversationId, '');
        if (!draftResult.ok) draftClearError = draftResult.error.message;
      } catch {
        draftClearError = 'Could not clear the WhatsApp draft.';
      }
    }

    await this.refresh();

    if (
      draftClearError !== null &&
      this.#state.selectedConversationId === attempt.conversationId &&
      this.#state.composerText === ''
    ) {
      this.#publish({ errorMessage: draftClearError });
    }
  }

  async markUnread(conversationId: string): Promise<void> {
    await this.#runMutation(() => this.#client.markUnread(conversationId));
  }

  async setArchived(conversationId: string, archived: boolean): Promise<void> {
    await this.#runMutation(() => this.#client.archive(conversationId, archived));
  }

  async setFollowUp(conversationId: string, followUp: boolean): Promise<void> {
    await this.#runMutation(() => this.#client.setFollowUp(conversationId, followUp));
  }

  async #drainRefreshes(): Promise<void> {
    this.#publish({ refreshing: true });
    try {
      while (this.#refreshPending) {
        this.#refreshPending = false;
        await this.#refreshOnce();

        if (
          this.#refreshPending &&
          (this.#environment.isDocumentHidden() || !this.#environment.isOnline())
        ) {
          this.#refreshPending = false;
        }
      }
    } finally {
      this.#publish({ refreshing: false });
    }
  }

  async #refreshOnce(): Promise<void> {
    let result: Awaited<ReturnType<TuxWhatsAppApi['loadInbox']>>;
    try {
      result = await this.#client.loadInbox();
    } catch {
      this.#publish({ errorMessage: 'WhatsApp inbox refresh failed.' });
      return;
    }

    if (!result.ok) {
      this.#publish({ errorMessage: result.error.message });
      return;
    }

    const nextSnapshot = result.value;
    const visibleConversations = this.#visibleConversations(nextSnapshot);
    this.#publish({
      snapshot: nextSnapshot,
      visibleConversations,
      totalUnread: totalUnreadCount(nextSnapshot.conversations),
      lastRefreshedAt: this.#environment.nowMs(),
      errorMessage: null,
    });

    await this.#synchronizeSelection(visibleConversations);
  }

  #visibleConversations(snapshot: WhatsAppInboxSnapshot): readonly WhatsAppConversation[] {
    return filterAndSortWhatsAppConversations(
      snapshot.conversations,
      snapshot.messages,
      this.#state.filter,
      this.#state.search,
    );
  }

  async #recomputeVisibleAndSelection(): Promise<void> {
    const snapshot = this.#state.snapshot;
    if (snapshot === null) {
      this.#publish({ visibleConversations: [], totalUnread: 0 });
      await this.#synchronizeSelection([]);
      return;
    }

    const visibleConversations = this.#visibleConversations(snapshot);
    this.#publish({
      visibleConversations,
      totalUnread: totalUnreadCount(snapshot.conversations),
    });
    await this.#synchronizeSelection(visibleConversations);
  }

  async #synchronizeSelection(
    visibleConversations: readonly WhatsAppConversation[],
  ): Promise<void> {
    const selectedConversationId = this.#state.selectedConversationId;
    if (
      selectedConversationId !== null &&
      visibleConversations.some((item) => item.id === selectedConversationId)
    ) {
      return;
    }

    const firstConversation = visibleConversations[0];
    if (firstConversation !== undefined) {
      await this.selectConversation(firstConversation.id);
      return;
    }

    await this.#clearSelection();
  }

  async #clearSelection(): Promise<void> {
    if (!(await this.#flushPendingDraft())) return;

    ++this.#selectionGeneration;
    this.#sendAttempt = null;
    this.#publish({
      selectedConversationId: null,
      selectedMessages: [],
      composerText: '',
    });
  }

  #selectionIsCurrent(generation: number, conversationId: string): boolean {
    return (
      generation === this.#selectionGeneration &&
      this.#state.selectedConversationId === conversationId
    );
  }

  async #savePendingDraft(pending: PendingDraft): Promise<boolean> {
    if (this.#draftSavePromise !== null) {
      const previousSaved = await this.#draftSavePromise;
      if (!previousSaved) return false;
    }

    const savePromise = this.#performDraftSave(pending);
    this.#draftSavePromise = savePromise;
    try {
      return await savePromise;
    } finally {
      if (this.#draftSavePromise === savePromise) {
        this.#draftSavePromise = null;
      }
    }
  }

  async #performDraftSave(pending: PendingDraft): Promise<boolean> {
    let result: Awaited<ReturnType<TuxWhatsAppApi['saveDraft']>>;
    try {
      result = await this.#client.saveDraft(pending.conversationId, pending.text);
    } catch {
      if (
        this.#pendingDraft === null &&
        this.#state.selectedConversationId === pending.conversationId &&
        this.#state.composerText === pending.text
      ) {
        this.#pendingDraft = pending;
      }
      this.#publish({ errorMessage: 'Could not save the WhatsApp draft.' });
      return false;
    }

    if (result.ok) return true;

    if (
      this.#pendingDraft === null &&
      this.#state.selectedConversationId === pending.conversationId &&
      this.#state.composerText === pending.text
    ) {
      this.#pendingDraft = pending;
    }
    this.#publish({ errorMessage: result.error.message });
    return false;
  }

  async #flushPendingDraft(): Promise<boolean> {
    if (this.#draftTimer !== null) {
      this.#environment.clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
    }

    if (this.#draftSavePromise !== null) {
      const previousSaved = await this.#draftSavePromise;
      if (!previousSaved) return false;
    }

    const pending = this.#pendingDraft;
    if (pending === null) return true;

    this.#pendingDraft = null;
    return this.#savePendingDraft(pending);
  }

  #sendVisualContextMatches(attempt: SendAttempt): boolean {
    return (
      this.#state.selectedConversationId === attempt.conversationId &&
      this.#state.composerText === attempt.text &&
      this.#sendAttempt?.outboundIntentKey === attempt.outboundIntentKey
    );
  }

  async #runMutation(operation: () => ReturnType<TuxWhatsAppApi['markUnread']>): Promise<void> {
    let result: Awaited<ReturnType<TuxWhatsAppApi['markUnread']>>;
    try {
      result = await operation();
    } catch {
      this.#publish({ errorMessage: 'WhatsApp operation failed.' });
      return;
    }

    if (!result.ok) {
      this.#publish({ errorMessage: result.error.message });
      return;
    }

    await this.refresh();
  }

  #publish(patch: Partial<WhatsAppInboxUiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
