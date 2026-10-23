// The public menu is read-only. Poll only while the document is visible, and
// refresh immediately when the user returns from another tab or reconnects.
export const MENU_REFRESH_INTERVAL_MS = 15_000;

type RefreshWindow = Pick<
  Window,
  'setInterval' | 'clearInterval' | 'addEventListener' | 'removeEventListener'
>;
type RefreshDocument = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

export function startMenuRefreshLifecycle(
  hostWindow: RefreshWindow,
  hostDocument: RefreshDocument,
  refresh: () => void,
): () => void {
  const refreshWhenVisible = () => {
    if (hostDocument.visibilityState === 'visible') refresh();
  };

  const timer = hostWindow.setInterval(refreshWhenVisible, MENU_REFRESH_INTERVAL_MS);
  hostWindow.addEventListener('focus', refreshWhenVisible);
  hostWindow.addEventListener('online', refreshWhenVisible);
  hostDocument.addEventListener('visibilitychange', refreshWhenVisible);

  return () => {
    hostWindow.clearInterval(timer);
    hostWindow.removeEventListener('focus', refreshWhenVisible);
    hostWindow.removeEventListener('online', refreshWhenVisible);
    hostDocument.removeEventListener('visibilitychange', refreshWhenVisible);
  };
}
