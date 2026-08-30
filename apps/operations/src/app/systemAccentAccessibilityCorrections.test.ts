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
const PANELS = {
  light: parseSystemAccentColor('#FFFFFF'),
  dark: parseSystemAccentColor('#141816'),
} as const;
const DESTRUCTIVE = {
  light: '#B42318',
  dark: '#F06B61',
} as const;
const RED_COLLISION_MATRIX = {
  light: ['#B42318', '#B52319', '#DC2626'],
  dark: ['#F06B61', '#EF6A60', '#DC2626'],
} as const;
const ACTION_STATE_DISTANCE_MIN = 12;

describe('system accent accessibility corrections', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const input of MATRIX) {
      it(`derives ${theme} solid action states with one readable foreground for ${input}`, () => {
        const palette = deriveSystemAccentPalette(parseSystemAccentColor(input), theme);
        const foreground = systemAccentColorToRgb(parseSystemAccentColor(palette.actionForeground));
        const panel = systemAccentColorToRgb(PANELS[theme]);
        const surfaces = [palette.strong, palette.hover, palette.pressed].map((surface) =>
          systemAccentColorToRgb(surface),
        );
        for (const surface of surfaces) {
          expect(contrastRatio(surface, foreground)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(surface, panel)).toBeGreaterThanOrEqual(3);
        }
        for (let left = 0; left < surfaces.length; left += 1) {
          for (let right = left + 1; right < surfaces.length; right += 1) {
            expect(
              systemAccentColorDistance(surfaces[left]!, surfaces[right]!),
            ).toBeGreaterThanOrEqual(ACTION_STATE_DISTANCE_MIN);
          }
        }
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

  it('scopes custom action surfaces and foregrounds away from the canonical default path', () => {
    expect(featureCss).toContain(
      ':root[data-tux-custom-accent] .place-order-action:not(:hover):not(:active)',
    );
    expect(featureCss).toContain('background: var(--tux-accent-strong);');
    expect(featureCss).toContain('color: var(--tux-action-foreground);');
    expect(featureCss).toContain(':root[data-tux-custom-accent] .primary-action');
    expect(featureCss).toContain(
      ':root[data-tux-custom-accent] .place-order-action:not(:disabled):hover',
    );
    expect(featureCss).toContain(
      ':root[data-tux-custom-accent] .place-order-action:not(:disabled):active',
    );
  });

  it('uses accent-text for every custom selected label rendered directly on accent-soft', () => {
    const selectors = [
      '.operations-header .nav-item-active',
      '.operator-menu .appearance-option-active',
      '.menu-toolbar .category-rail button.selected',
      '.product-family-filter button.selected',
      '.order-type-section .segmented-control button.selected',
      '.payment-methods button.selected',
    ];
    for (const selector of selectors) {
      expect(featureCss).toContain(`:root[data-tux-custom-accent] ${selector}`);
    }

    const block =
      featureCss.match(
        /:root\[data-tux-custom-accent\] \.operations-header \.nav-item-active,[^{]+\{([^}]*)\}/s,
      )?.[1] ?? '';
    expect(block).toContain('background: var(--tux-accent-soft);');
    expect(block).toContain('color: var(--tux-accent-text);');
    expect(block).not.toContain('color: var(--tux-accent-strong);');
  });
});
