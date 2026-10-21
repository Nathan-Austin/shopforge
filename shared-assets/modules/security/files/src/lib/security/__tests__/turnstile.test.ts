import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstile } from "../turnstile";

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

describe("verifyTurnstile", () => {
  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
  });

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
    vi.unstubAllGlobals();
  });

  it("returns false when no token is provided", async () => {
    expect(await verifyTurnstile(null)).toBe(false);
    expect(await verifyTurnstile(undefined)).toBe(false);
    expect(await verifyTurnstile("")).toBe(false);
  });

  it("returns false when the secret is not configured (fails closed)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile("some-token")).toBe(false);
  });

  it("returns true when Cloudflare reports success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      }),
    );

    expect(await verifyTurnstile("valid-token")).toBe(true);
  });

  it("returns false when Cloudflare reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      }),
    );

    expect(await verifyTurnstile("bad-token")).toBe(false);
  });

  it("fails closed on a network/API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    expect(await verifyTurnstile("some-token")).toBe(false);
  });

  it("fails closed on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    expect(await verifyTurnstile("some-token")).toBe(false);
  });
});
