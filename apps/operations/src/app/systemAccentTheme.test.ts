import { parseSystemAccentColor } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import {
  clearSystemAccentPalette,
  contrastRatio,
  deriveSystemAccentPalette,
  parseHexDraft,
  rgbToSystemAccentColor,
  systemAccentColorToRgb,
} from './systemAccentTheme';

const LIGHT_PANEL = { r: 255, g: 255, b: 255 };
const DARK_PANEL = { r: 20, g: 24, b: 22 };
const MATRIX = ['#1F6B52', '#1E3A8A', '#7E22CE', '#DC2626', '#FACC15', '#050505', '#FAFAFA'] as const;

describe('system accent theme', () => {
  it('normalizes draft HEX and converts RGB deterministically', () => {
    expect(parseHexDraft('#1e3a8a')).toBe('#1E3A8A');
    expect(parseHexDraft('#123')).toBe('#112233');
    expect(parseHexDraft('#12')).toBeNull();
    expect(systemAccentColorToRgb(parseSystemAccentColor('#1E3A8A'))).toEqual({
      r: 30,
      g: 58,
      b: 138,
    });
    expect(rgbToSystemAccentColor({ r: 30, g: 58, b: 138 })).toBe('#1E3A8A');
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(
      21,
      2,
    );
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const input of MATRIX) {
      it(`derives an accessible ${theme} palette from ${input}`, () => {
        const palette = deriveSystemAccentPalette(parseSystemAccentColor(input), theme);
        const panel = theme === 'light' ? LIGHT_PANEL : DARK_PANEL;
        const accent = systemAccentColorToRgb(parseSystemAccentColor(palette.accent));
        const foreground = systemAccentColorToRgb(parseSystemAccentColor(palette.actionForeground));
        const soft = systemAccentColorToRgb(parseSystemAccentColor(palette.soft));
        const text = systemAccentColorToRgb(parseSystemAccentColor(palette.text));
        const focus = systemAccentColorToRgb(parseSystemAccentColor(palette.focusRing));

        expect(contrastRatio(accent, foreground)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(accent, panel)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(text, soft)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(focus, panel)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it('derives a dark companion rather than reusing a dark raw base unchanged', () => {
    expect(deriveSystemAccentPalette(parseSystemAccentColor('#1E3A8A'), 'dark').accent).not.toBe(
      '#1E3A8A',
    );
  });

  it('removes only runtime accent token overrides when clearing the palette', () => {
    const removed: string[] = [];
    const root = {
      style: {
        removeProperty(name: string) {
          removed.push(name);
        },
      },
    } as unknown as HTMLElement;

    clearSystemAccentPalette(root);

    expect(removed.sort()).toEqual(
      [
        '--tux-accent',
        '--tux-accent-hover',
        '--tux-accent-pressed',
        '--tux-accent-strong',
        '--tux-accent-text',
        '--tux-accent-soft',
        '--tux-accent-hover-soft',
        '--tux-focus-ring',
        '--tux-action-foreground',
      ].sort(),
    );
  });
});
