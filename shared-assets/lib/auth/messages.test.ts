import { describe, expect, it } from 'vitest';

import { authErrorKey, safeNextPath } from './messages';

describe('authErrorKey', () => {
  it('maps the Supabase codes a customer can actually hit', () => {
    expect(authErrorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('invalidCredentials');
    expect(authErrorKey({ code: 'email_not_confirmed' })).toBe('emailNotConfirmed');
    expect(authErrorKey({ code: 'otp_expired' })).toBe('codeInvalid');
    expect(authErrorKey({ code: 'mfa_verification_failed' })).toBe('codeInvalid');
    expect(authErrorKey({ code: 'user_already_exists' })).toBe('userExists');
    expect(authErrorKey({ code: 'weak_password' })).toBe('weakPassword');
    expect(authErrorKey({ code: 'over_email_send_rate_limit' })).toBe('rateLimited');
  });

  it('treats a 429 without a known code as rate limiting', () => {
    expect(authErrorKey({ status: 429 })).toBe('rateLimited');
  });

  it('falls back to the generic message, and to nothing for no error', () => {
    expect(authErrorKey({ code: 'something_new', message: 'English only' })).toBe('generic');
    expect(authErrorKey({ message: 'Failed to fetch' })).toBe('generic');
    expect(authErrorKey(null)).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/de/checkout/success?session_id=cs_1', '/en')).toBe('/de/checkout/success?session_id=cs_1');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '@evil.com', 'https://evil.com', 'evil.com', '/ space']) {
      expect(safeNextPath(bad, '/en')).toBe('/en');
    }
    expect(safeNextPath(null, '/en')).toBe('/en');
    expect(safeNextPath('', '/en')).toBe('/en');
  });
});
