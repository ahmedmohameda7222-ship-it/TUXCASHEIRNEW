import { readFileSync } from 'node:fs';
import { parseSystemAccentColor } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import {
  SYSTEM_ACCENT_DESTRUCTIVE_DISTANCE_MIN,
  contrastRatio,
  deriveSystemAccentPalette,
  systemAccentColorDistance,
  systemAccentColorToRgb,
} from './systemAccentTheme';

const premiumCss = readFileSync(new URL('../styles/premium.css', import.meta.url), 'utf8');
const featureCss = readFileSync(
  new URL('../styles/system-color-picker.css', import.meta.url),
  'utf8',
);
const MATRIX = [
  '#1F6B52',
  '#1E3A8A',
  '#7E22CE',
  '#DC2626',
  '#FACC15',
  '#050505',
  '#FAFAFA',
] as const;
const DESTRUCTIVE = {
  light: '#B42318',
  dark: '#F06B61',
} as const;
const RED_COLLISION_MATRIX = {
  light: ['#B42318', '#B52319', '#DC2626'],
  dark: ['#F06B61', '#EF6A60', '#DC2626'],
} as const;

describe('system accent accessibility corrections', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const input of MATRIX) {
      it(`derives ${theme} action foreground against the actual strong action surface for ${input}`, () => {
        const palette = deriveSystemAccentPalette(parseSystemAccentColor(input), theme);
        expect(
          contrastRatio(
            systemAccentColorToRgb(palette.strong),
            systemAccentColorToRgb(parseSystemAccentColor(palette.actionForeground)),
          ),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const input of RED_COLLISION_MATRIX[theme]) {
      it(`keeps ${theme} brand action companion measurably separate from destructive for ${input}`, () => {
        const palette = deriveSystemAccentPalette(parseSystemAccentColor(input), theme);
        expect(
          systemAccentColorDistance(
            systemAccentColorToRgb(palette.strong),
            systemAccentColorToRgb(parseSystemAccentColor(DESTRUCTIVE[theme])),
          ),
        ).toBeGreaterThanOrEqual(SYSTEM_ACCENT_DESTRUCTIVE_DISTANCE_MIN);
      });
    }
  }

  it('renders an opaque custom-accent focus indicator while leaving the canonical default focus rule intact', () => {
    expect(premiumCss).toContain(
      'outline: 3px solid color-mix(in srgb, var(--tux-focus-ring) 36%, transparent);',
    );
    expect(featureCss).toMatch(
      /:root\[data-tux-custom-accent\] :focus-visible\s*{[^}]*outline-color:\s*var\(--tux-focus-ring\);/s,
    );
  });

  it('uses accent-text for every selected label rendered directly on accent-soft', () => {
    for (const selector of [
      '.operations-header .nav-item-active',
      '.operator-menu .appearance-option-active',
      '.menu-toolbar .category-rail button.selected',
      '.menu-segmented button.selected',
      '.order-type-toggle button.selected',
      '.payment-options button.selected',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const block = featureCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';
      expect(block, selector).toContain('background: var(--tux-accent-soft);');
      expect(block, selector).toContain('color: var(--tux-accent-text);');
      expect(block, selector).not.toContain('color: var(--tux-accent-strong);');
    }
  });
});
