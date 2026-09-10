import { hashPin, pinLookupHash } from './pin';

export class OwnerBootstrapError extends Error {
  constructor(readonly code: 'owner_already_exists' | 'pin_already_in_use' | 'bootstrap_failed') {
    super(code);
    this.name = 'OwnerBootstrapError';
  }
}

export type OwnerBootstrapInput = {
  displayName: string;
  pin: string;
};

export type OwnerBootstrapDependencies = {
  pinLookupSecret: string;
  createOwner(input: {
    displayName: string;
    pinLookupHash: string;
    pinHash: string;
  }): Promise<string>;
};

export async function bootstrapOwner(
  input: OwnerBootstrapInput,
  deps: OwnerBootstrapDependencies,
): Promise<{ employeeId: string }> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120) throw new Error('invalid_owner_display_name');

  const [lookupHash, verifier] = await Promise.all([
    pinLookupHash(input.pin, deps.pinLookupSecret),
    hashPin(input.pin),
  ]);

  try {
    const employeeId = await deps.createOwner({
      displayName,
      pinLookupHash: lookupHash,
      pinHash: verifier,
    });
    return { employeeId };
  } catch (error) {
    if (error instanceof OwnerBootstrapError) throw error;
    const message = error instanceof Error ? error.message : '';
    if (message.includes('TUX_ADMIN_OWNER_ALREADY_EXISTS')) {
      throw new OwnerBootstrapError('owner_already_exists');
    }
    if (message.includes('TUX_ADMIN_PIN_ALREADY_IN_USE')) {
      throw new OwnerBootstrapError('pin_already_in_use');
    }
    throw new OwnerBootstrapError('bootstrap_failed');
  }
}
