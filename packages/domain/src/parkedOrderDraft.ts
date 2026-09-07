import { DomainInvariantError } from './errors';
import type { BusinessDayId, ShopId, WorkerId } from './ids';
import type { OrderDraft } from './orderDraft';
import type { Instant } from './time';

export type ParkedOrderDraftState = 'PARKED' | 'RESTORED' | 'DISCARDED';

export interface ParkedOrderDraft {
  readonly id: string;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly draftScopeId: string;
  readonly draft: OrderDraft;
  readonly parkedAt: Instant;
  readonly parkedByWorkerId: WorkerId;
  readonly state: ParkedOrderDraftState;
  readonly resolvedAt: Instant | null;
  readonly resolvedByWorkerId: WorkerId | null;
}

export function assertParkedOrderDraftInvariant(value: ParkedOrderDraft): void {
  if (value.id.trim().length === 0) {
    throw new DomainInvariantError('Parked order draft id is required.');
  }
  if (value.draftScopeId.trim().length === 0) {
    throw new DomainInvariantError('Parked order draft scope is required.');
  }
  if (
    value.draft.shopId !== value.shopId ||
    value.draft.businessDayId !== value.businessDayId ||
    value.draft.draftScopeId !== value.draftScopeId
  ) {
    throw new DomainInvariantError('Parked order draft authority must match its nested draft.');
  }
  if (value.state === 'PARKED') {
    if (value.resolvedAt !== null || value.resolvedByWorkerId !== null) {
      throw new DomainInvariantError('A PARKED order draft must remain unresolved.');
    }
    return;
  }
  if (value.resolvedAt === null || value.resolvedByWorkerId === null) {
    throw new DomainInvariantError(
      'A resolved parked order draft requires resolver time and worker.',
    );
  }
}
