const NOT_IMPLEMENTED_MESSAGE = 'Task 4 online-order acceptance is not implemented.';

export function prepareOnlineOrderAcceptanceDraft(_input: unknown): never {
  throw new Error(NOT_IMPLEMENTED_MESSAGE);
}

export class OperationsOnlineOrderAcceptanceService {
  constructor(_orders: unknown, _runtime: unknown) {}

  async accept(_request: unknown, _confirmation: unknown): Promise<never> {
    throw new Error(NOT_IMPLEMENTED_MESSAGE);
  }
}
