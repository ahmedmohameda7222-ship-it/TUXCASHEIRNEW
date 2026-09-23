export type AdminCustomerIdentity = {
  id: string;
  businessId: string;
  normalizedPhone: string;
  displayName: string | null;
  mergedIntoCustomerId: string | null;
};

export type AdminCustomerMergeInput = {
  survivorCustomerId: string;
  mergedCustomerId: string;
  confirmed: boolean;
  commandId: string;
};

export type AdminCustomerMergeResult =
  | {
      ok: true;
      survivorCustomerId: string;
      mergedCustomerId: string;
      replayed: boolean;
    }
  | {
      ok: false;
      code: string;
    };
