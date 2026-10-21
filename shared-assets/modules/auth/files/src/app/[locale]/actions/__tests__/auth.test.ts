import { describe, it, expect, vi, beforeEach } from "vitest";

const { signUpMock, checkRateLimitMock, verifyTurnstileMock, isSameOriginMock } = vi.hoisted(
  () => ({
    signUpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    verifyTurnstileMock: vi.fn(),
    isSameOriginMock: vi.fn(),
  }),
);

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "https://example.com" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signUp: signUpMock } }),
}));
vi.mock("@/lib/security/ip", () => ({ getClientIp: async () => "203.0.113.5" }));
vi.mock("@/lib/security/rateLimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: verifyTurnstileMock }));
vi.mock("@/lib/security/origin", () => ({ isSameOrigin: isSameOriginMock }));

import { signUp } from "../auth";

const validInput = {
  email: "real.user@example.com",
  password: "correct-horse-battery",
  locale: "en",
  honeypot: "",
  renderedAt: Date.now() - 5000,
  turnstileToken: "good-token",
};

beforeEach(() => {
  signUpMock.mockReset().mockResolvedValue({ error: null });
  checkRateLimitMock.mockReset().mockResolvedValue(true);
  verifyTurnstileMock.mockReset().mockResolvedValue(true);
  isSameOriginMock.mockReset().mockResolvedValue(true);
});

describe("signUp", () => {
  it("passes through and creates the account on a valid submission", async () => {
    const result = await signUp(validInput);

    expect(result.success).toBe(true);
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when the honeypot is filled", async () => {
    const result = await signUp({ ...validInput, honeypot: "http://spam.example" });

    expect(result.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects once the rate limit has been exceeded", async () => {
    checkRateLimitMock.mockResolvedValue(false);

    const result = await signUp(validInput);

    expect(result.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects a missing Turnstile token", async () => {
    const result = await signUp({ ...validInput, turnstileToken: "" });

    expect(result.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Turnstile token (fails closed)", async () => {
    verifyTurnstileMock.mockResolvedValue(false);

    const result = await signUp(validInput);

    expect(result.error).toBe("Verification failed. Please try again.");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin submission", async () => {
    isSameOriginMock.mockResolvedValue(false);

    const result = await signUp(validInput);

    expect(result.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
