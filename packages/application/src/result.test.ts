import { describe, expect, it } from 'vitest';
import { err, ok } from './result';

describe('Result primitives', () => {
  it('represents success without an error branch', () => {
    expect(ok('saved')).toEqual({ ok: true, value: 'saved' });
  });

  it('represents failure without a value branch', () => {
    expect(err('failed')).toEqual({ ok: false, error: 'failed' });
  });
});
