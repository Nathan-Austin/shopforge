import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

import { checkRateLimit } from "../rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls the rate_limit_check RPC with the right arguments", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    const allowed = await checkRateLimit({
      key: "route:ip:1.2.3.4",
      windowSeconds: 3600,
      maxHits: 5,
    });

    expect(allowed).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("rate_limit_check", {
      p_key: "route:ip:1.2.3.4",
      p_window_seconds: 3600,
      p_max_hits: 5,
    });
  });

  it("returns false once the RPC reports the caller is over the limit", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const allowed = await checkRateLimit({
      key: "route:ip:1.2.3.4",
      windowSeconds: 3600,
      maxHits: 5,
    });

    expect(allowed).toBe(false);
  });

  it("fails open if the rate limiter itself errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("db down") });

    const allowed = await checkRateLimit({
      key: "route:ip:1.2.3.4",
      windowSeconds: 3600,
      maxHits: 5,
    });

    expect(allowed).toBe(true);
  });
});
