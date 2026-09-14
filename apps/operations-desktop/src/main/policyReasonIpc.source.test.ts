import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const endDaySource = readFileSync(new URL('./endDayIpc.ts', import.meta.url), 'utf8');

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Could not find source section ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
}

describe('desktop reason identity IPC boundaries', () => {
  it('forwards cancellation reasonCodeId and optional note', () => {
    const section = between(mainSource, 'ipcMain.handle(IPC_BOARD_CANCEL', 'ipcMain.handle(IPC_BOARD_RETURN');
    expect(section).toContain("input['reasonCodeId']");
    expect(section).toContain("input['note']");
    expect(section).toContain('reasonCodeId:');
    expect(section).toContain('note:');
  });

  it('forwards delivery-return reasonCodeId and optional note', () => {
    const section = between(mainSource, 'ipcMain.handle(IPC_BOARD_RETURN', 'if (workerMenuLayoutIpcRuntime === null)');
    expect(section).toContain("input['reasonCodeId']");
    expect(section).toContain("input['note']");
    expect(section).toContain('reasonCodeId:');
    expect(section).toContain('note:');
  });

  it('preserves cash-variance reasonCodeId through End Day parsing', () => {
    const section = between(endDaySource, 'function parseVarianceReasons', 'export class EndDayIpcRuntime');
    expect(section).toContain("entry['reasonCodeId']");
    expect(section).toContain('reasonCodeId:');
  });
});
