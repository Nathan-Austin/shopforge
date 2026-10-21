import disposableDomains from "disposable-email-domains";

const DISPOSABLE_DOMAINS = new Set(disposableDomains.map((d) => d.toLowerCase()));

// Short, stable list of generic mailbox prefixes bots/scrapers favor for
// throwaway signups. Deliberately not exhaustive — this is a cheap extra
// filter, not the primary defense.
const ROLE_PREFIXES = new Set([
  "admin",
  "info",
  "support",
  "sales",
  "noreply",
  "no-reply",
  "webmaster",
  "postmaster",
  "abuse",
  "contact",
]);

export function isDisposableOrRoleEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;

  const localPart = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();

  return ROLE_PREFIXES.has(localPart) || DISPOSABLE_DOMAINS.has(domain);
}
