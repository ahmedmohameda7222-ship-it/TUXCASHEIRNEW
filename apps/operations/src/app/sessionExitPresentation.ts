import type { OperationsSessionState } from '@tux/application';

export function presentCompletedSessionExit(input: {
  readonly browser: boolean;
  readonly session: OperationsSessionState;
  readonly returnToBranchPicker: () => void;
  readonly showInAppSession: (session: OperationsSessionState) => void;
}): void {
  if (input.browser) {
    input.returnToBranchPicker();
    return;
  }
  input.showInAppSession(input.session);
}
