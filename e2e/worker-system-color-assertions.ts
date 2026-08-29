import type { Locator, Page } from '@playwright/test';

export interface Paint {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineWidth: string;
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

function rgb(value: string): readonly [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Unsupported computed color ${value}`);
  return [channels[0]!, channels[1]!, channels[2]!];
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((channel) => {
    const next = channel / 255;
    return next <= 0.04045 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}
