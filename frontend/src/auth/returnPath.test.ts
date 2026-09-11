import { beforeEach, describe, expect, it } from 'vitest';
import { consumeReturnPath } from './returnPath';

describe('sign-in return path', () => {
  beforeEach(() => sessionStorage.clear());
  it('returns to the guest reservation and consumes the saved path', () => {
    sessionStorage.setItem('miootz_return_path', '/plus-one/demo-token');
    expect(consumeReturnPath()).toBe('/plus-one/demo-token');
    expect(consumeReturnPath()).toBe('/');
  });
  it.each(['https://other.example', '//other.example', '/\\other.example', '/auth/callback?code=old'])('rejects unsafe or callback path %s', (path) => {
    sessionStorage.setItem('miootz_return_path', path);
    expect(consumeReturnPath()).toBe('/');
  });
});
