import { describe, expect, it } from 'vitest';
import { createSecureWebPreferences, parseLoopbackDevelopmentUrl } from './security';

describe('Electron security foundation', () => {
  it('keeps privileged renderer capabilities disabled', () => {
    expect(createSecureWebPreferences('/tmp/preload.js')).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('accepts only loopback HTTP development URLs', () => {
    expect(parseLoopbackDevelopmentUrl('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/');
    expect(parseLoopbackDevelopmentUrl('http://localhost:5173')).toBe('http://localhost:5173/');
    expect(() => parseLoopbackDevelopmentUrl('https://example.com')).toThrow();
    expect(() => parseLoopbackDevelopmentUrl('http://example.com')).toThrow();
  });
});
