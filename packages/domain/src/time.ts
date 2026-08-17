import { brandValue, type Brand } from './brand';
import { DomainInvariantError } from './errors';

export type Instant = Brand<string, 'Instant'>;

export function instant(value: string | Date): Instant {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainInvariantError(`Invalid instant: ${String(value)}`);
  }
  return brandValue<string, 'Instant'>(date.toISOString());
}
