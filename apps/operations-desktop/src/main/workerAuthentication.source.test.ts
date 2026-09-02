import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'apps/operations-desktop/src/main/index.ts'),
  'utf8',
);

function handlerBody(channel: string): string {
  const start = source.indexOf(`ipcMain.handle(${channel}`);
  if (start < 0) throw new Error(`Missing IPC handler ${channel}.`);
  const next = source.indexOf('ipcMain.handle(', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe('Electron worker authentication wiring', () => {
  it('constructs the shared authoritative worker authentication service with the Supabase adapter', () => {
    expect(source).toContain('OperationsWorkerAuthenticationService');
    expect(source).toContain('SupabaseWorkerAuthenticator');
  });

  it('routes PIN IPC through the authoritative worker authentication service instead of local-first session auth', () => {
    const submitPin = handlerBody('IPC_SESSION_SUBMIT_PIN');
    expect(submitPin).toContain('currentWorkerAuthenticationService().submitPin(pin)');
    expect(submitPin).not.toContain('currentSessionService().submitPin(pin)');
  });
});
