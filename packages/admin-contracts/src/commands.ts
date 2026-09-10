export type CommandEnvelope<T> = {
  commandId: string;
  expectedVersion?: number;
  shopId?: string;
  payload: T;
};

export type CommandResult<T> =
  | { ok: true; value: T; version?: number }
  | { ok: false; code: string; message: string; currentVersion?: number };
