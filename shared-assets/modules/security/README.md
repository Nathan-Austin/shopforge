# security

Bot and spam protection shared by every public form (sign-up, reviews,
newsletter, contact).

| File | Purpose |
| --- | --- |
| `lib/security/rateLimit.ts` | `checkRateLimit({ key, windowSeconds, maxHits })`, backed by the `rate_limit_check` RPC so limits hold across serverless instances. Fails open. |
| `lib/security/formGuards.ts` | `isHoneypotTripped`, `isTooFast` (rejects submissions under 2s after render). |
| `components/security/useFormGuard.ts` | Client hook that renders the hidden honeypot field and captures `renderedAt`. |
| `lib/security/origin.ts` | `isSameOrigin()` compares the Origin/Referer host with Host. |
| `lib/security/ip.ts` | `getClientIp()` from `x-forwarded-for` / `x-real-ip`. |
| `lib/security/email.ts` | `isDisposableOrRoleEmail()` for throwaway and role mailboxes. |
| `lib/security/turnstile.ts` + `components/security/TurnstileWidget.tsx` | Cloudflare Turnstile, verified server-side. Fails closed. |
| `lib/security/log.ts` | `logRejection()` structured log line. Never pass PII. |

## Typical server action

```ts
const ip = await getClientIp();
if (!(await isSameOrigin())) { logRejection({ route, ip, reason: "bad_origin" }); return fail; }
if (isHoneypotTripped(form.website) || isTooFast(form.renderedAt)) return fakeSuccess;
if (!(await checkRateLimit({ key: `${route}:ip:${ip}`, windowSeconds: 3600, maxHits: 5 }))) return fail;
```

Requires `src/lib/supabase/admin.ts` (provided by `shared-assets/lib`).
Tests run with `vitest run`.
