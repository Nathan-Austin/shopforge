import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, maybeSingleMock, upsertMock, sendEmailMock, checkRateLimitMock } = vi.hoisted(
  () => {
    const maybeSingleMock = vi.fn();
    const upsertMock = vi.fn();
    const fromMock = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleMock,
      upsert: upsertMock,
    }));
    return {
      fromMock,
      maybeSingleMock,
      upsertMock,
      sendEmailMock: vi.fn(),
      checkRateLimitMock: vi.fn(),
    };
  },
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: fromMock }),
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "https://example.com" }),
}));
vi.mock("@/lib/emails/client", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/emails/templates", () => ({
  getNewsletterVerificationHtml: () => "<html></html>",
}));
vi.mock("@/lib/security/ip", () => ({ getClientIp: async () => "203.0.113.1" }));
vi.mock("@/lib/security/rateLimit", () => ({ checkRateLimit: checkRateLimitMock }));

import { subscribeToNewsletter } from "../newsletter";

const validInput = {
  email: "real.user@example.com",
  locale: "en",
  honeypot: "",
  renderedAt: Date.now() - 5000,
};

beforeEach(() => {
  fromMock.mockClear();
  maybeSingleMock.mockReset().mockResolvedValue({ data: null, error: null });
  upsertMock.mockReset().mockResolvedValue({ error: null });
  sendEmailMock.mockReset().mockResolvedValue({ success: true });
  checkRateLimitMock.mockReset().mockResolvedValue(true);
});

describe("subscribeToNewsletter", () => {
  it("passes through and sends the confirmation email on a valid submission", async () => {
    const result = await subscribeToNewsletter(validInput);

    expect(result.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when the honeypot is filled, without writing or emailing anything", async () => {
    const result = await subscribeToNewsletter({
      ...validInput,
      honeypot: "http://spam.example",
    });

    expect(result.error).toBeTruthy();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects a submission that arrives too fast", async () => {
    const result = await subscribeToNewsletter({ ...validInput, renderedAt: Date.now() });

    expect(result.error).toBeTruthy();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects once the rate limit has been exceeded", async () => {
    checkRateLimitMock.mockResolvedValue(false);

    const result = await subscribeToNewsletter(validInput);

    expect(result.error).toBeTruthy();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects disposable/role-based email addresses", async () => {
    const result = await subscribeToNewsletter({ ...validInput, email: "admin@example.com" });

    expect(result.error).toBeTruthy();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
