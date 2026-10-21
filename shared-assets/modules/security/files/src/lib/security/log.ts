/**
 * Structured logging for rejected submissions. Never pass PII (email,
 * name, address) as `reason` — callers should use short codes like
 * "honeypot", "too_fast", "rate_limited", "invalid_turnstile",
 * "bad_origin", "disposable_email", "invalid_schema".
 */
export function logRejection({
  route,
  ip,
  reason,
}: {
  route: string;
  ip: string;
  reason: string;
}) {
  console.warn(
    JSON.stringify({
      event: "security_rejection",
      timestamp: new Date().toISOString(),
      route,
      ip,
      reason,
    }),
  );
}
