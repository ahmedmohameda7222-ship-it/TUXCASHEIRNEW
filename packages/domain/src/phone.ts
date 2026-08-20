export interface EgyptianPhoneNormalization {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly valid: boolean;
}

const EGYPTIAN_MOBILE_LOCAL_PATTERN = /^01(?:0|1|2|5)\d{8}$/;
const ALLOWED_PHONE_INPUT_PATTERN = /^\+?[0-9\s()./-]+$/;

function invalidPhone(normalizedPhone: string): EgyptianPhoneNormalization {
  return { normalizedPhone, displayPhone: normalizedPhone, valid: false };
}

/**
 * Normalize the intentionally supported Egyptian mobile forms without ever
 * truncating input. Supported equivalents are:
 *   01xxxxxxxxx
 *   +201xxxxxxxxx
 *   00201xxxxxxxxx
 *   201xxxxxxxxx
 *   1xxxxxxxxx
 * Common spacing and phone punctuation are accepted.
 */
export function normalizeEgyptianPhone(raw: string): EgyptianPhoneNormalization {
  const input = String(raw ?? '').trim();
  if (input.length === 0) return invalidPhone('');
  if (!ALLOWED_PHONE_INPUT_PATTERN.test(input)) return invalidPhone(input);
  if (input.includes('+') && !input.startsWith('+')) return invalidPhone(input);

  const compact = input.replace(/[\s()./-]/g, '');
  let digits: string;
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+20')) return invalidPhone(compact);
    digits = compact.slice(1);
  } else if (compact.startsWith('00')) {
    if (!compact.startsWith('0020')) return invalidPhone(compact);
    digits = compact.slice(2);
  } else {
    digits = compact;
  }

  let normalizedPhone: string;
  if (digits.startsWith('20')) {
    if (digits.length !== 12) return invalidPhone(digits);
    normalizedPhone = `0${digits.slice(2)}`;
  } else if (digits.startsWith('0')) {
    if (digits.length !== 11) return invalidPhone(digits);
    normalizedPhone = digits;
  } else {
    if (digits.length !== 10) return invalidPhone(digits);
    normalizedPhone = `0${digits}`;
  }

  if (!EGYPTIAN_MOBILE_LOCAL_PATTERN.test(normalizedPhone)) {
    return invalidPhone(normalizedPhone);
  }

  return {
    normalizedPhone,
    displayPhone: `+20${normalizedPhone.slice(1)}`,
    valid: true,
  };
}
