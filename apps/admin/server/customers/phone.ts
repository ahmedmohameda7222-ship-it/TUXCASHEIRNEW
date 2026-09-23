export class CustomerPhoneError extends Error {
  constructor(readonly code = 'customer_phone_invalid') {
    super(code);
    this.name = 'CustomerPhoneError';
  }
}

export function canonicalizeEgyptPhone(input: string): string {
  const compact = input.trim().replace(/[\s()\-]/g, '');
  let canonical: string;

  if (compact.startsWith('+20')) {
    canonical = compact;
  } else if (compact.startsWith('0020')) {
    canonical = `+20${compact.slice(4)}`;
  } else if (compact.startsWith('20')) {
    canonical = `+${compact}`;
  } else if (compact.startsWith('0')) {
    canonical = `+20${compact.slice(1)}`;
  } else {
    throw new CustomerPhoneError();
  }

  if (!/^\+20(?:10|11|12|15)\d{8}$/.test(canonical)) {
    throw new CustomerPhoneError();
  }

  return canonical;
}
