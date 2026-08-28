import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('worker system color lifecycle', () => {
  it('hydrates worker-owned accent before showing the active operations shell', () => {
    expect(source).toContain('createWorkerUiPreferencesClient');
    expect(source).toContain('session.operator.id');
    expect(source).toContain('accentHydrated');
    expect(source).toMatch(/preferencesClient\s*\.\s*load\(\)/);
    expect(source).toContain('clearSystemAccentPalette(document.documentElement)');
  });

  it('keeps Appearance device-local while resolving custom palettes for live light/dark mode', () => {
    expect(source).toContain("matchMedia('(prefers-color-scheme: dark)')");
    expect(source).toContain('deriveSystemAccentPalette');
    expect(source).toContain('applySystemAccentPalette');
    expect(source).not.toContain('updateAccentColor(theme');
  });

  it('adds a separate System color profile entry and persists only accent changes', () => {
    expect(source).toContain('System color');
    expect(source).toContain('Choose system color');
    expect(source).toContain('<SystemColorPickerDialog');
    expect(source).toContain('preferencesClient.updateAccentColor(accentColor)');
  });

  it('closes previous-worker color UI and ignores stale save responses after a worker change', () => {
    expect(source).toContain('const accentWorkerIdRef = useRef(session.operator.id)');
    expect(source).toContain('accentWorkerIdRef.current = session.operator.id');
    expect(source).toContain('setSystemColorOpen(false)');
    expect(source).toContain('const saveWorkerId = session.operator.id');
    expect(source).toContain('if (accentWorkerIdRef.current !== saveWorkerId) return;');
  });
});
