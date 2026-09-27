export const BUSINESS_TIME_ZONE = 'Africa/Cairo';

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function offsetMinutesAt(instantMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: 'longOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const zone = formatter
    .formatToParts(new Date(instantMs))
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zone ?? '');
  if (!match) throw new Error('business_timezone_offset_unavailable');
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function businessParts(instantMs: number) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
  };
}

export function businessLocalDateTimeToIso(value: string): string {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) throw new Error('invalid_business_local_datetime');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error('invalid_business_local_datetime');
  }

  const localEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = localEpoch - offsetMinutesAt(localEpoch) * 60_000;
  instant = localEpoch - offsetMinutesAt(instant) * 60_000;

  const parts = businessParts(instant);
  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute ||
    parts.second !== second
  ) {
    throw new Error('invalid_business_local_datetime');
  }

  return new Date(instant).toISOString();
}

export function formatBusinessDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_business_timestamp');
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}


export function businessDateTimeInputValue(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_business_timestamp');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values['year']}-${values['month']}-${values['day']}T${values['hour']}:${values['minute']}`;
}
