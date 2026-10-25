import { describe, expect, it, vi } from 'vitest';
import { presentCompletedSessionExit } from './sessionExitPresentation';

describe('completed browser session exit presentation', () => {
  it('returns browser End Day and Sign out to the branch picker instead of the in-app PIN screen', () => {
    const returnToBranchPicker = vi.fn();
    const showInAppSession = vi.fn();
    const session = { status: 'NO_ACTIVE_DAY' } as never;

    presentCompletedSessionExit({
      browser: true,
      session,
      returnToBranchPicker,
      showInAppSession,
    });

    expect(returnToBranchPicker).toHaveBeenCalledOnce();
    expect(showInAppSession).not.toHaveBeenCalled();
  });

  it('keeps the desktop shell responsible for presenting its local session state', () => {
    const returnToBranchPicker = vi.fn();
    const showInAppSession = vi.fn();
    const session = { status: 'NO_ACTIVE_DAY' } as never;

    presentCompletedSessionExit({
      browser: false,
      session,
      returnToBranchPicker,
      showInAppSession,
    });

    expect(returnToBranchPicker).not.toHaveBeenCalled();
    expect(showInAppSession).toHaveBeenCalledOnce();
    expect(showInAppSession).toHaveBeenCalledWith(session);
  });
});
