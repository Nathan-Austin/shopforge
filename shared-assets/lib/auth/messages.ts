/**
 * The sign-in pages' two small rules, kept pure so they are tested:
 *
 *   * authErrorKey(): Supabase answers in English, so its error is turned
 *     into one of a few translated messages (Auth.errors.*) by its code. An
 *     error with no known code shows the generic message; the raw text goes
 *     to the console for whoever is debugging, never to the customer.
 *   * safeNextPath(): where to land after a link. Same-site paths only, so
 *     a crafted `?next=` can never send someone to another site.
 */

export const AUTH_ERROR_KEYS = [
  'invalidCredentials',
  'emailNotConfirmed',
  'rateLimited',
  'codeInvalid',
  'userExists',
  'weakPassword',
  'samePassword',
  'generic'
] as const;
export type AuthErrorKey = (typeof AUTH_ERROR_KEYS)[number];

const BY_CODE: Record<string, AuthErrorKey> = {
  invalid_credentials: 'invalidCredentials',
  email_not_confirmed: 'emailNotConfirmed',
  over_email_send_rate_limit: 'rateLimited',
  over_request_rate_limit: 'rateLimited',
  over_sms_send_rate_limit: 'rateLimited',
  otp_expired: 'codeInvalid',
  mfa_verification_failed: 'codeInvalid',
  mfa_challenge_expired: 'codeInvalid',
  user_already_exists: 'userExists',
  email_exists: 'userExists',
  weak_password: 'weakPassword',
  same_password: 'samePassword'
};

export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

export function authErrorKey(error: AuthErrorLike | null | undefined): AuthErrorKey | null {
  if (!error) return null;
  const byCode = error.code ? BY_CODE[error.code] : undefined;
  if (byCode) return byCode;
  if (error.status === 429) return 'rateLimited';
  return 'generic';
}

/** `next` if it is a path on this site, otherwise the fallback. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  // One leading slash, then not another one or a backslash: "//evil.com"
  // and "/\evil.com" are other sites to a browser. No "@" or scheme can
  // sneak in after the origin this way either.
  return /^\/(?![/\\])[^\s]*$/.test(next) ? next : fallback;
}
