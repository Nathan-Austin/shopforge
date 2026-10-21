// A honeypot field real users never see or fill in; any non-empty value
// means the submission almost certainly came from an automated bot.
export function isHoneypotTripped(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// Bots that skip rendering the page (or replay a captured request) tend to
// submit near-instantly. Real users need at least this long to read the
// form and type into it.
export function isTooFast(renderedAt: unknown, minMs = 2000): boolean {
  const ts = typeof renderedAt === "number" ? renderedAt : Number(renderedAt);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts < minMs;
}
