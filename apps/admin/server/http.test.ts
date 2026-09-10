import { describe, expect, it } from 'vitest';

import {
  requireSameOrigin,
  shouldUseSecureCookie,
  type AdminRequest,
  type AdminResponse,
} from './http';

function request(headers: Record<string, string>): AdminRequest {
  return { headers } as unknown as AdminRequest;
}

function responseCapture(): {
  response: AdminResponse;
  status: () => number;
  body: () => string;
} {
  let statusCode = 200;
  let body = '';
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader() {
      return response;
    },
    end(value?: unknown) {
      body = value === undefined ? '' : String(value);
      return response;
    },
  } as unknown as AdminResponse;
  return { response, status: () => statusCode, body: () => body };
}

describe('Admin mutation origin validation', () => {
  it('rejects mutation requests with no Origin header', () => {
    const capture = responseCapture();

    expect(requireSameOrigin(request({ host: 'admin.tux.example' }), capture.response)).toBe(false);
    expect(capture.status()).toBe(403);
    expect(capture.body()).toContain('origin_not_allowed');
  });

  it('accepts an exact same-origin host and forwarded protocol', () => {
    const capture = responseCapture();

    expect(
      requireSameOrigin(
        request({
          origin: 'https://admin.tux.example',
          host: 'admin.tux.example',
          'x-forwarded-proto': 'https',
        }),
        capture.response,
      ),
    ).toBe(true);
    expect(capture.status()).toBe(200);
  });

  it('rejects cross-origin or protocol-mismatched mutation requests', () => {
    const crossOrigin = responseCapture();
    expect(
      requireSameOrigin(
        request({ origin: 'https://evil.example', host: 'admin.tux.example' }),
        crossOrigin.response,
      ),
    ).toBe(false);
    expect(crossOrigin.status()).toBe(403);

    const wrongProtocol = responseCapture();
    expect(
      requireSameOrigin(
        request({
          origin: 'http://admin.tux.example',
          host: 'admin.tux.example',
          'x-forwarded-proto': 'https',
        }),
        wrongProtocol.response,
      ),
    ).toBe(false);
    expect(wrongProtocol.status()).toBe(403);
  });

  it('forces Secure cookies in production even if forwarded protocol metadata is wrong', () => {
    const previous = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      expect(shouldUseSecureCookie(request({ 'x-forwarded-proto': 'http' }))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previous;
    }
  });
});
