import { parseSystemAccentColor, type SystemAccentColor } from '@tux/domain';

export type EffectiveTheme = 'light' | 'dark';

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SystemAccentPalette {
  readonly accent: SystemAccentColor;
  readonly hover: SystemAccentColor;
  readonly pressed: SystemAccentColor;
  readonly strong: SystemAccentColor;
  readonly text: SystemAccentColor;
  readonly soft: SystemAccentColor;
  readonly hoverSoft: SystemAccentColor;
  readonly focusRing: SystemAccentColor;
  readonly actionForeground: '#000000' | '#FFFFFF';
}

const LIGHT_PANEL: RgbColor = { r: 255, g: 255, b: 255 };
const DARK_PANEL: RgbColor = { r: 20, g: 24, b: 22 };
const BLACK: RgbColor = { r: 0, g: 0, b: 0 };
const WHITE: RgbColor = { r: 255, g: 255, b: 255 };

const TOKEN_MAP = {
  accent: '--tux-accent',
  hover: '--tux-accent-hover',
  pressed: '--tux-accent-pressed',
  strong: '--tux-accent-strong',
  text: '--tux-accent-text',
  soft: '--tux-accent-soft',
  hoverSoft: '--tux-accent-hover-soft',
  focusRing: '--tux-focus-ring',
  actionForeground: '--tux-action-foreground',
} as const;

export function parseHexDraft(value: string): SystemAccentColor | null {
  const trimmed = value.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (match === null) return null;
  const digits = match[1]!;
  const normalized =
    digits.length === 3
      ? `#${digits
          .split('')
          .map((digit) => `${digit}${digit}`)
          .join('')}`
      : `#${digits}`;
  return parseSystemAccentColor(normalized);
}

export function systemAccentColorToRgb(color: SystemAccentColor): RgbColor {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}

export function rgbToSystemAccentColor({ r, g, b }: RgbColor): SystemAccentColor {
  for (const channel of [r, g, b]) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError('RGB channels must be integers between 0 and 255.');
    }
  }
  const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('');
  return parseSystemAccentColor(`#${hex}`);
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function blend(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const clamped = Math.min(1, Math.max(0, amount));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}

function ensureContrast(
  candidate: RgbColor,
  surface: RgbColor,
  target: number,
  toward: RgbColor,
): RgbColor {
  if (contrastRatio(candidate, surface) >= target) return candidate;

  let low = 0;
  let high = 1;
  let best = toward;
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const midpoint = (low + high) / 2;
    const adjusted = blend(candidate, toward, midpoint);
    if (contrastRatio(adjusted, surface) >= target) {
      best = adjusted;
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return best;
}

function accessibleText(
  accent: RgbColor,
  background: RgbColor,
  toward: RgbColor,
): RgbColor {
  return ensureContrast(accent, background, 4.5, toward);
}

function bestActionForeground(accent: RgbColor): '#000000' | '#FFFFFF' {
  return contrastRatio(accent, BLACK) >= contrastRatio(accent, WHITE) ? '#000000' : '#FFFFFF';
}

export function deriveSystemAccentPalette(
  color: SystemAccentColor,
  theme: EffectiveTheme,
): SystemAccentPalette {
  const raw = systemAccentColorToRgb(color);
  const panel = theme === 'light' ? LIGHT_PANEL : DARK_PANEL;
  const direction = theme === 'light' ? BLACK : WHITE;
  const prepared = theme === 'dark' ? blend(raw, WHITE, 0.08) : raw;
  const accentRgb = ensureContrast(prepared, panel, 3, direction);
  const hoverRgb =
    theme === 'light' ? blend(accentRgb, BLACK, 0.1) : blend(accentRgb, WHITE, 0.12);
  const pressedRgb =
    theme === 'light' ? blend(accentRgb, BLACK, 0.2) : blend(accentRgb, BLACK, 0.12);
  const softRgb = blend(panel, accentRgb, theme === 'light' ? 0.12 : 0.24);
  const hoverSoftRgb = blend(panel, hoverRgb, theme === 'light' ? 0.17 : 0.31);
  const textRgb = accessibleText(accentRgb, softRgb, direction);
  const focusRgb = ensureContrast(accentRgb, panel, 3, direction);

  return {
    accent: rgbToSystemAccentColor(accentRgb),
    hover: rgbToSystemAccentColor(hoverRgb),
    pressed: rgbToSystemAccentColor(pressedRgb),
    strong: rgbToSystemAccentColor(pressedRgb),
    text: rgbToSystemAccentColor(textRgb),
    soft: rgbToSystemAccentColor(softRgb),
    hoverSoft: rgbToSystemAccentColor(hoverSoftRgb),
    focusRing: rgbToSystemAccentColor(focusRgb),
    actionForeground: bestActionForeground(accentRgb),
  };
}

export function applySystemAccentPalette(root: HTMLElement, palette: SystemAccentPalette): void {
  for (const [key, token] of Object.entries(TOKEN_MAP) as Array<
    [keyof typeof TOKEN_MAP, (typeof TOKEN_MAP)[keyof typeof TOKEN_MAP]]
  >) {
    root.style.setProperty(token, palette[key]);
  }
}

export function clearSystemAccentPalette(root: HTMLElement): void {
  for (const token of Object.values(TOKEN_MAP)) root.style.removeProperty(token);
}
