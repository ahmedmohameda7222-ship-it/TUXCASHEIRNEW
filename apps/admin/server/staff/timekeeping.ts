export type WorkedMinutesInput = {
  readonly clockIn: string;
  readonly clockOut: string;
  readonly breakMinutes: number;
};

export type OvertimeMinutesInput = {
  readonly workedMinutes: number;
  readonly regularMinutes: number;
};

export type LateMinutesInput = {
  readonly scheduledStart: string;
  readonly actualStart: string;
};

export type LeftEarlyMinutesInput = {
  readonly scheduledEnd: string;
  readonly actualEnd: string;
};

function requireNonNegativeInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('invalid_time_value');
  return hour * 60 + minute;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('invalid_timestamp');
  return ms;
}

function wholePositiveMinutes(deltaMs: number): number {
  if (deltaMs <= 0) return 0;
  return Math.floor(deltaMs / 60_000);
}

export function calculateWorkedMinutes(input: WorkedMinutesInput): number {
  const breakMinutes = requireNonNegativeInteger(input.breakMinutes, 'invalid_break_minutes');
  const startClock = clockMinutes(input.clockIn);
  const endClock = clockMinutes(input.clockOut);

  let elapsedMinutes: number;
  if (startClock !== null || endClock !== null) {
    if (startClock === null || endClock === null) throw new Error('mixed_time_formats');
    let end = endClock;
    if (end < startClock) end += 24 * 60;
    elapsedMinutes = end - startClock;
  } else {
    const startMs = timestampMs(input.clockIn);
    const endMs = timestampMs(input.clockOut);
    if (endMs < startMs) throw new Error('clock_out_before_clock_in');
    elapsedMinutes = Math.floor((endMs - startMs) / 60_000);
  }

  return Math.max(0, elapsedMinutes - breakMinutes);
}

export function calculateOvertimeMinutes(input: OvertimeMinutesInput): number {
  const worked = requireNonNegativeInteger(input.workedMinutes, 'invalid_worked_minutes');
  const regular = requireNonNegativeInteger(input.regularMinutes, 'invalid_regular_minutes');
  return Math.max(0, worked - regular);
}

export function calculateLateMinutes(input: LateMinutesInput): number {
  return wholePositiveMinutes(timestampMs(input.actualStart) - timestampMs(input.scheduledStart));
}

export function calculateLeftEarlyMinutes(input: LeftEarlyMinutesInput): number {
  return wholePositiveMinutes(timestampMs(input.scheduledEnd) - timestampMs(input.actualEnd));
}
