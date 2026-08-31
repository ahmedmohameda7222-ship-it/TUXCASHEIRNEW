import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideProtectedTransition } from './unsavedChangesGuard';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('decideProtectedTransition', () => {
  it('runs immediately when the menu editor is closed', () => {
    expect(decideProtectedTransition({ lifecycle: 'CLOSED', dirty: false })).toBe('RUN');
  });

  it('runs immediately when the open menu editor is clean', () => {
    expect(decideProtectedTransition({ lifecycle: 'EDITING', dirty: false })).toBe('RUN');
  });

  it('requires confirmation for a dirty editable menu layout', () => {
    expect(decideProtectedTransition({ lifecycle: 'EDITING', dirty: true })).toBe('CONFIRM');
    expect(decideProtectedTransition({ lifecycle: 'ERROR', dirty: true })).toBe('CONFIRM');
  });

  it('blocks protected transitions while a menu layout save is in flight', () => {
    expect(decideProtectedTransition({ lifecycle: 'SAVING', dirty: true })).toBe('BLOCK');
    expect(decideProtectedTransition({ lifecycle: 'SAVING', dirty: false })).toBe('BLOCK');
  });
});

describe('ActiveShell protected transition scope', () => {
  it('does not guard the already-active Orders destination', () => {
    expect(appSource).toContain("onClick={() => setArea('ORDERS')}");
    expect(appSource).not.toContain("requestProtectedTransition(() => setArea('ORDERS'))");
  });
});
