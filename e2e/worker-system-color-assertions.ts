import type { Locator, Page } from '@playwright/test';

type CssRgb = readonly [number, number, number];

export interface Paint {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineWidth: string;
}

function parseComputedColor(value: string): CssRgb {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('rgb(') || normalized.startsWith('rgba(')) {
    const start = normalized.indexOf('(') + 1;
    const end = normalized.lastIndexOf(')');
    const channels = normalized
      .slice(start, end)
      .split(/[\s,/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(Number);
    if (channels.length === 3 && channels.every(Number.isFinite)) {
      return [channels[0]!, channels[1]!, channels[2]!];
    }
  }
  if (normalized.startsWith('color(srgb ')) {
    const channels = normalized
      .slice('color(srgb '.length, -1)
      .split(/[\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((channel) => Number(channel) * 255);
    if (channels.length === 3 && channels.every(Number.isFinite)) {
      return [channels[0]!, channels[1]!, channels[2]!];
    }
  }
  throw new Error(`Unsupported computed CSS color: ${value}`);
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: CssRgb): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrast(left: string, right: string): number {
  const leftLuminance = luminance(parseComputedColor(left));
  const rightLuminance = luminance(parseComputedColor(right));
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

export async function paint(locator: Locator): Promise<Paint> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
    };
  });
}

export async function resolvedColor(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const node = document.createElement('span');
    node.style.color = value;
    document.body.append(node);
    const color = getComputedStyle(node).color;
    node.remove();
    return color;
  }, expression);
}
