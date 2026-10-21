import { headers } from "next/headers";

/**
 * Verifies a state-changing POST actually originated from this site, by
 * comparing the Origin (or Referer, as a fallback) header's host against
 * the request's own Host header. Works across preview/staging deployments
 * without needing a hardcoded allowlist.
 */
export async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return false;

  const originHeader = h.get("origin");
  const source = originHeader || h.get("referer");
  if (!source) return false;

  try {
    const sourceHost = new URL(source).host;
    return sourceHost === host;
  } catch {
    return false;
  }
}
