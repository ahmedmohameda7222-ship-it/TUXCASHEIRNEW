export interface EgyptianPhoneNormalization {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly valid: boolean;
}

function legacyNormalizeDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('20')) {
    return digits.slice(0, 12);
  }
  if (digits.startsWith('2') && digits.length > 11) {
    return digits.slice(0, 12);
  }
  return digits.slice(0, 11);
}

function canonicalLocalPhone(raw: string): string {
  const digits = legacyNormalizeDigits(raw);
  if (digits.length === 0) return '';
  const local = digits.startsWith('20')
    ? digits.slice(2, 12)
    : digits.startsWith('0')
      ? digits.slice(1, 11)
      : digits.slice(0, 10);
  if (local.length === 0) return '';
  return `0${local}`.slice(0, 11);
}

export function normalizeEgyptianPhone(raw: string): EgyptianPhoneNormalization {
  const normalizedPhone = canonicalLocalPhone(String(raw ?? ''));
  const valid = /^0\d{10}$/.test(normalizedPhone);
  return {
    normalizedPhone,
    displayPhone: valid ? `+20${normalizedPhone.slice(1)}` : normalizedPhone,
    valid,
  };
}
