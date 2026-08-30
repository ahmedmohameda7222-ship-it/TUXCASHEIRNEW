import type { MenuLayoutEditorLifecycle } from './menuLayoutEditorSession';

export interface ProtectedTransitionState {
  readonly lifecycle: MenuLayoutEditorLifecycle;
  readonly dirty: boolean;
}

export type ProtectedTransitionDecision = 'RUN' | 'CONFIRM' | 'BLOCK';

export function decideProtectedTransition(
  state: ProtectedTransitionState,
): ProtectedTransitionDecision {
  if (state.lifecycle === 'SAVING') return 'BLOCK';
  if (state.dirty) return 'CONFIRM';
  return 'RUN';
}
